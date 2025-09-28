# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

**MikroTik Adapter Context:**
This adapter connects to MikroTik RouterOS devices via the MikroTik API protocol (typically port 8728). The adapter enables monitoring and control of:
- Network interfaces and their status
- DHCP server information and client lists
- Wireless/WiFi client connections and signal strength
- Firewall rules and NAT configurations
- System information and resource usage
- CAPsMAN (wireless access point management)
- System commands like reboot, shutdown, USB reset

The adapter uses the `mikronode-ng` library for API communication and supports both polling for status updates and executing commands on the router.

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.your-adapter.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties
                        Object.assign(obj.native, {
                            position: TEST_COORDINATES,
                            createCurrently: true,
                            createHourly: true,
                            createDaily: true,
                            // Add other configuration as needed
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to process data
                        const waitMs = 15000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Check if info.connection state exists and is true
                        const connectionState = await harness.states.getStateAsync('your-adapter.0.info.connection');
                        
                        if (connectionState && connectionState.val === true) {
                            console.log('✅ SUCCESS: Adapter is connected and working');
                            resolve();
                        } else {
                            reject(new Error('Adapter connection state not found or false'));
                        }
                        
                    } catch (error) {
                        console.error('❌ Test failed:', error);
                        reject(error);
                    }
                });
            }).timeout(60000);
        });
    }
});
```

#### Alternative Test Pattern
For simpler tests, you can also use the basic integration test structure:

```javascript
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'));
```

#### MikroTik-Specific Testing Considerations
- Mock the MikroNode connection to avoid requiring an actual router during tests
- Test command parsing and response handling separately
- Provide sample MikroTik API responses for different device states
- Test error handling for network timeouts and authentication failures

## Common Patterns and Best Practices

### Adapter Core Structure

#### Main Entry Point
```javascript
const utils = require('@iobroker/adapter-core');

function startAdapter(options) {
    return adapter = utils.adapter(Object.assign({}, options, {
        name: 'your-adapter-name',
        ready: main, // called when adapter is ready
        unload: (callback) => {
            // Clean up resources
            try {
                // Stop timers, close connections
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange: (id, state) => {
            // Handle state changes
        }
    }));
}

async function main() {
    // Adapter initialization
    adapter.log.info('Adapter started');
    
    // Set connection state
    await adapter.setStateAsync('info.connection', false, true);
}
```

#### State Management
```javascript
// Set state with acknowledgment
await adapter.setStateAsync('your.state.id', value, true);

// Get state
const state = await adapter.getStateAsync('your.state.id');

// Create state object
await adapter.setObjectNotExistsAsync('your.state.id', {
    type: 'state',
    common: {
        name: 'State description',
        type: 'number',
        role: 'value',
        read: true,
        write: false,
        def: 0
    },
    native: {}
});
```

#### Object Management
```javascript
// Create device
await adapter.setObjectNotExistsAsync('device.id', {
    type: 'device',
    common: {
        name: 'Device Name'
    },
    native: {}
});

// Create channel
await adapter.setObjectNotExistsAsync('device.id.channel', {
    type: 'channel',
    common: {
        name: 'Channel Name'
    },
    native: {}
});
```

#### Error Handling
```javascript
try {
    // Adapter operations
} catch (error) {
    adapter.log.error(`Operation failed: ${error.message}`);
    // Set connection state to false on critical errors
    await adapter.setStateAsync('info.connection', false, true);
}
```

### Cleanup and Resource Management

#### Proper Unload Implementation
```javascript
unload: (callback) => {
  // Clear all timers
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  
  // Close connections
  if (connection && connection.close) {
    connection.close();
  }
  
  // Clear intervals
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  
  // Final cleanup
  try {
    adapter.log.debug('cleaned everything up...');
    callback();
  } catch (e) {
    callback();
  }
}
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## CI/CD and Testing Integration

### GitHub Actions for API Testing
For adapters with external API dependencies, implement separate CI/CD jobs:

```yaml
# Tests API connectivity with demo credentials (runs separately)
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run demo API tests
      run: npm run test:integration-demo
```

### CI/CD Best Practices
- Run credential tests separately from main test suite
- Use ubuntu-22.04 for consistency
- Don't make credential tests required for deployment
- Provide clear failure messages for API connectivity issues
- Use appropriate timeouts for external API calls (120+ seconds)

### Package.json Script Integration
Add dedicated script for credential testing:
```json
{
  "scripts": {
    "test:integration-demo": "mocha test/integration-demo --exit"
  }
}
```

### Practical Example: Complete API Testing Implementation
Here's a complete example based on lessons learned from the Discovergy adapter:

#### test/integration-demo.js
```javascript
const path = require("path");
const { tests } = require("@iobroker/testing");

// Helper function to encrypt password using ioBroker's encryption method
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    
    if (!systemConfig || !systemConfig.native || !systemConfig.native.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }
    
    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    
    return result;
}

// Run integration tests with demo credentials
tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("API Testing with Demo Credentials", (getHarness) => {
            let harness;
            
            before(() => {
                harness = getHarness();
            });

            it("Should connect to API and initialize with demo credentials", async () => {
                console.log("Setting up demo credentials...");
                
                if (harness.isAdapterRunning()) {
                    await harness.stopAdapter();
                }
                
                const encryptedPassword = await encryptPassword(harness, "demo_password");
                
                await harness.changeAdapterConfig("your-adapter", {
                    native: {
                        username: "demo@provider.com",
                        password: encryptedPassword,
                        // other config options
                    }
                });

                console.log("Starting adapter with demo credentials...");
                await harness.startAdapter();
                
                // Wait for API calls and initialization
                await new Promise(resolve => setTimeout(resolve, 60000));
                
                const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");
                
                if (connectionState && connectionState.val === true) {
                    console.log("✅ SUCCESS: API connection established");
                    return true;
                } else {
                    throw new Error("API Test Failed: Expected API connection to be established with demo credentials. " +
                        "Check logs above for specific API errors (DNS resolution, 401 Unauthorized, network issues, etc.)");
                }
            }).timeout(120000);
        });
    }
});
```

**MikroTik Adapter Specific Patterns:**

### MikroNode API Usage
```javascript
const MikroNode = require('mikronode-ng');

// Connection establishment
const connection = new MikroNode(host, port);
connection.connect(username, password)
  .then(() => {
    adapter.log.info('Connected to MikroTik router');
    adapter.setState('info.connection', true, true);
  })
  .catch(error => {
    adapter.log.error(`Connection failed: ${error.message}`);
    adapter.setState('info.connection', false, true);
  });

// Command execution
connection.write('/system/resource/print', (chan) => {
    chan.once('done', (data) => {
        const result = MikroNode.parseItems(data);
        // Process the result
    });
    chan.once('error', (error) => {
        adapter.log.error(`Command failed: ${error.message}`);
    });
});
```

### State Management for Router Data
```javascript
// Create states for interface monitoring
async function createInterfaceStates(interfaceName) {
    const basePath = `interface.${interfaceName}`;
    
    await adapter.setObjectNotExistsAsync(`${basePath}.status`, {
        type: 'state',
        common: {
            name: `${interfaceName} Status`,
            type: 'string',
            role: 'text',
            read: true,
            write: false
        },
        native: {}
    });
    
    await adapter.setObjectNotExistsAsync(`${basePath}.rx-byte`, {
        type: 'state',
        common: {
            name: `${interfaceName} RX Bytes`,
            type: 'number',
            role: 'value',
            unit: 'bytes',
            read: true,
            write: false
        },
        native: {}
    });
}
```

### Command Handling
```javascript
// Handle commands sent to the adapter
stateChange: (id, state) => {
    if (state && !state.ack) {
        const ids = id.split('.');
        const command = ids[ids.length - 1];
        
        switch (command) {
            case 'reboot':
                executeRouterCommand('/system/reboot');
                break;
            case 'add_firewall':
                addFirewallRule(state.val);
                break;
            case 'raw':
                executeRawCommand(state.val);
                break;
        }
    }
}
```

### Error Handling for Network Devices
```javascript
// Robust error handling for network connectivity
function handleConnectionError(error, retry = true) {
    adapter.log.error(`Connection error: ${error.message}`);
    adapter.setState('info.connection', false, true);
    
    if (retry && retryCount < maxRetries) {
        retryCount++;
        setTimeout(() => {
            adapter.log.info(`Retrying connection (${retryCount}/${maxRetries})`);
            connectToRouter();
        }, retryInterval);
    } else {
        adapter.log.error('Max retries reached, giving up');
    }
}
```

### Configuration Validation
```javascript
// Validate adapter configuration on startup
function validateConfig() {
    if (!adapter.config.host || !adapter.config.login) {
        adapter.log.error('Host and login are required');
        return false;
    }
    
    if (!adapter.config.port || adapter.config.port < 1 || adapter.config.port > 65535) {
        adapter.log.error('Invalid port number');
        return false;
    }
    
    return true;
}
```
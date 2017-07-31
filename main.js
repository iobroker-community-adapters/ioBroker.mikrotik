"use strict";

var utils =    require(__dirname + '/lib/utils');
var adapter = utils.adapter('mikrotik');
var MikroNode = require('mikronode-ng');

var _poll, poll_time = 5000, connect = false, _connection, con, timer;
var states = {
    "wireless" :    [],
    "dhcp" :        [],
    "interface" :   [],
    "filter" :      [],
    "nat" :         [],
    "lists":        {
        "dhcp_list" :   [],
        "wifi_list" :   []
    },
    "systeminfo" :  {}
};
var old_states = {
    "wireless" :    [],
    "dhcp" :        [],
    "interface" :   [],
    "filter" :      [],
    "nat" :         [],
    "lists":        {
        "dhcp_list" :   [],
        "wifi_list" :   []
    },
    "systeminfo" :  {}
};
var commands = {
    "reboot": "/system/reboot",
    "shutdown": "/system/shutdown",
    "usb_reset": "/system/routerboard/usb/power-reset"
};

adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

adapter.on('objectChange', function (id, obj) {
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

adapter.on('stateChange', function (id, state) {
    if (state && !state.ack) {
        adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
        var ids = id.split(".");
        var val = state.val;
        var cmd = ids[ids.length - 1].toString().toLowerCase();
        //adapter.log.error('[cmd] = ' + cmd);
        if(commands[cmd] !== undefined){
            SetCommand(commands[cmd]);
        }
        if(cmd === 'raw'){
            SetCommand(val);
        }
        if (cmd === 'disabled'){
            var _id;
            id = id.replace('disabled', 'id');
            adapter.getState(id, function (err, st){
                if ((err || !st)){
                    adapter.log.error('getState ' + JSON.stringify(err));
                } else {
                    _id = st.val.replace('*', '');
                    GetCmd(id, cmd, _id, val);
                }
            });
        }
    }
});

function GetCmd(id, cmd, _id, val){
    var set;
    var ids = id.split(".");
    if (val === true || val === 'true'){
        val = 'yes';
    } else {
        val = 'no';
    }
    if(ids[2] === 'filter'){
        set = '/ip/firewall/filter/set\n=disabled='+ val + '\n=.id=*' + _id;
    }
    if(ids[2] === 'interface'){
        set = '/interface/set\n=disabled='+ val + '\n=.id=*' + _id;
    }
    if(ids[2] === 'nat'){
        set = '/ip/firewall/nat/set\n=disabled='+ val + '\n=.id=*' + _id;
    }



    SetCommand(set);
}

function SetCommand(set){
    adapter.log.debug('SetCommand ' + set);
    _connection.getConnectPromise().then(function(conn) {
        conn.getCommandPromise(set).then(function resolved(values) {
            
        }, function rejected(reason) {
            err(reason);
        });
    });
}

adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

adapter.on('ready', function () {
    con = {
        "host" : adapter.config.host ? adapter.config.host: "192.168.88.1",
        "port" : adapter.config.port ? adapter.config.port: 8728,
        "login" : adapter.config.login ? adapter.config.login : "admin",
        "password" : adapter.config.password ? adapter.config.password : ""
    };
    main();
});

function main(){
    adapter.subscribeStates('*');

    if(con.host && con.port){
        var connection = MikroNode.getConnection(con.host, con.login, con.password, {
            port:           con.port,
            timeout:        15,
            closeOnTimeout: true,
            closeOnDone:    false
        });
        _connection = connection;

        connection.getConnectPromise().then(function (conn){
            adapter.log.info('MikroTik ' + conn.status + ' to: ' + conn.host);
            adapter.setState('info.connection', true, true);
            connect = true;
            poll(conn);
        });
    }
}

function poll(conn){
    clearInterval(_poll);
    _poll = setInterval(function() {
        var ch1 = conn.getCommandPromise('/system/resource/print');
        var ch2 = conn.getCommandPromise('/ip/firewall/nat/print');
        var ch3 = conn.getCommandPromise('/ip/dhcp-server/lease/print');
        var ch4 = conn.getCommandPromise('/interface/print');
        var ch5 = conn.getCommandPromise('/ip/firewall/filter/print');
        var ch6 = conn.getCommandPromise('/interface/wireless/registration-table/print');
        Promise.all([ ch1, ch2, ch3, ch4, ch5, ch6 ]).then(function resolved(values) {
            adapter.log.debug('/system/resource/print ' + JSON.stringify(values[0][0]) + '\n\n');
            adapter.log.debug('interface/wireless/registration-table ' + JSON.stringify(values[1]) + '\n\n');
            adapter.log.debug('ip/dhcp-server/lease ' + JSON.stringify(values[2]) + '\n\n');
            adapter.log.debug('interface ' + JSON.stringify(values[3]) + '\n\n');
            adapter.log.debug('ip/firewall/filter ' + JSON.stringify(values[4]) + '\n\n');
            adapter.log.debug('ip/firewall/nat ' + JSON.stringify(values[5]) + '\n\n');
            states.systeminfo = values[0][0];
            states.nat = ParseNat(values[1]);
            states.dhcp = ParseDHCP(values[2]);
            states.interface = ParseInterface(values[3]);
            states.filter = ParseFilter(values[4]);
            states.wireless = ParseWiFi(values[5]);
            SetStates(states);
        }, function rejected(reason) {
            err(reason);
        });
    }, poll_time);
}

function ParseNat(d){
    var res = [];
    d.forEach(function(item, i){
        if(d[i][".id"] !== undefined){
            res.push(
                {
                    "id":            d[i][".id"],
                    "chain":         d[i]["chain"],
                    "comment":       d[i]["comment"],
                    "disabled":      d[i]["disabled"],
                    "out-interface": d[i]["out-interface"],
                    "action":        d[i]["action"]
                });
        }
    });
    return res;
}

function ParseFilter(d){
    var res = [];
    d.forEach(function(item, i){
        if (d[i]["disabled"] !== undefined){
            res.push({
                "id":       d[i][".id"],
                "chain":    d[i]["chain"],
                "comment":  d[i]["comment"],
                "disabled": d[i]["disabled"]
            });
        }
    });
    return res;
}

function ParseInterface(d){
    var res = [];
    d.forEach(function(item, i){
        if (d[i]["name"] !== undefined){
            res.push({
                "name":         d[i]["name"],
                "id":           d[i][".id"],
                "type":         d[i]["type"],
                "disabled":     d[i]["disabled"],
                "mac-address":  d[i]["mac-address"],
                "running":      d[i]["running"]
            });
        }
    });
    return res;
}


function ParseWiFi(d){
    var res = [];
    states.lists.wifi_list = [];
    d.forEach(function(item, i) {
        if(d[i]["mac-address"]!== undefined){
            getNameWiFi(d[i]["mac-address"], function(name){
                res.push({
                    "last-ip":       d[i]["last-ip"],
                    "id":            d[i][".id"],
                    "mac-address":   d[i]["mac-address"],
                    "last-activity": d[i]["last-activity"],
                    "interface":     d[i]["interface"],
                    "name":          name
                });
            });
        }
        states.lists.wifi_list.push({
            "ip":    d[i]["last-ip"],
            "mac":   d[i]["mac-address"]
        });
    });
    return res;
}

function ParseDHCP(d){
    var res = [];
    states.lists.dhcp_list = [];
    d.forEach(function(item, i) {
        if(d[i]["host-name"]!== undefined){
            res.push(
                {
                    "name":        d[i]["host-name"],
                    "id":          d[i][".id"],
                    "address":     d[i]["address"],
                    "mac-address": d[i]["mac-address"],
                    "server":      d[i]["server"],
                    "status":      d[i]["status"],
                    "comment":     d[i]["comment"] ? d[i]["comment"] :'',
                    "blocked":     d[i]["blocked"]
                });
        }
        if(d[i]["host-name"]!== undefined && d[i]["status"] !== 'waiting'){
            states.lists.dhcp_list.push(
                {
                    "ip":  d[i]["address"],
                    "mac": d[i]["mac-address"]
                });
        }
    });
    return res;
}

function SetStates(states){
    var a = [];
    var obj = {};
    Object.keys(states).forEach(function(key) {
        //adapter.log.error('states[' + key +'] ' + states[key].length);
        if(states[key].length !== undefined && key !== 'lists'){
            a = states[key];
            a.forEach(function(item, i) {
                obj = a[i];
                Object.keys(obj).forEach(function(k) {
                    if(old_states[key][i] == undefined){
                        old_states[key].push({});
                    }
                    if (obj[k] !== old_states[key][i][k]){
                        old_states[key][i][k] = obj[k];
                        var ids = '';
                        if (obj['name'] !== undefined){
                            if (obj['server'] !== undefined){
                                ids = key + '.' + obj['server']  + '.' + obj['name'] + '.' + k;
                            } else {
                                ids = key + '.' + obj['name'] + '.' + k;
                            }
                        } else {
                            ids = key + '.id' + obj['id'] + '.' + k;
                        }
                        setObject(ids, states[key][i][k]);
                    }
                });
            });
        } else {
            obj = states[key];
            if (key === 'lists'){
                Object.keys(obj).forEach(function(k) {
                    var ids = key + '.' + k;
                    setObject(ids, JSON.stringify(states[key][k]));
                });
            } else if (key === 'systeminfo'){
                Object.keys(obj).forEach(function(k) {
                    if (obj[k] !== old_states[key][k]){
                        old_states[key][k] = obj[k];
                        var ids = key + '.' + k;
                        setObject(ids, states[key][k]);
                    }
                });
            }


        }
    });
}

function setObject(name, val){
    var type = 'string';
    var role = 'state';
    adapter.log.debug('setObject ' + JSON.stringify(name));
    adapter.getState(name, function (err, state){
        if ((err || !state)){
            if (~name.indexOf('disabled') || ~name.indexOf('blocked')){
                type = 'boolean';
            } else {
                role = 'indicator';
            }
            adapter.setObject(name, {
                type:   'state',
                common: {
                    name: name,
                    desc: name,
                    type: type,
                    role: role
                },
                native: {}
            });
            adapter.setState(name, {val: val, ack: true});
        } else {
            adapter.setState(name, {val: val, ack: true});
        }
    });
    adapter.subscribeStates('*');
}

function getNameWiFi(mac, cb){
    var a = states.dhcp;
    var res = mac;
    var n = 0;
    a.forEach(function(item, i){
        if (a[i]['mac-address'] === mac){
            res = a[i]['name'];
        }
        n++;
        if(n === a.length) {
            cb(res);
        }
    });
}

function err(e){
    e = e.toString();
    if (connect){
        adapter.log.error('Oops: ' + e);
    }
    if (~e.indexOf('ECONNRESET') || ~e.indexOf('closed') || ~e.indexOf('ended')){
        clearInterval(_poll);
        clearTimeout(timer);
        connect = false;
        adapter.log.error('Error socket: Reconnect after 15 sec...');
        adapter.setState('info.connection', false, true);
        timer = setTimeout(function() {
            main();
        }, 15000);
    }
}
"use strict";

var utils =    require(__dirname + '/lib/utils');
var adapter = utils.adapter('mikrotik');
var MikroNode = require('mikronode-ng');

var _poll, poll_time = 5000, connect = false, timer;
var con, _con, connection;
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
    if(connection){
        connection.close();
    }
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
    _con.write(set, function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            adapter.log.info('SetCommand response: ' + JSON.stringify(d));
        });
        ch.on('error', function(err, chan) {
            err(err);
        });
    });
}

adapter.on('message', function (obj) {
    if (typeof obj == 'object' && obj.message) {
        if (obj.command == 'send') {
            console.log('send command');
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

adapter.on('ready', function () {
    main();
});

function main(){
    adapter.subscribeStates('*');

    con = {
        "host" : adapter.config.host ? adapter.config.host: "192.168.1.11",
        "port" : adapter.config.port ? adapter.config.port: 8728,
        "login" : adapter.config.login ? adapter.config.login : "admin",
        "password" : adapter.config.password ? adapter.config.password : ""
    };
    if(con.host && con.port){
        var _connection = MikroNode.getConnection(con.host, con.login, con.password, {
            port:           con.port,
            timeout:        10,
            closeOnTimeout: true,
            closeOnDone:    false
        });
        connection = _connection.connect(function(c) {
            _con = c.openChannel();
            _con.clearEvents = true;
            adapter.log.info('MikroTik ' + c.status + ' to: ' + c.host);
            adapter.setState('info.connection', true, true);
            connect = true;
            parse();
        });
        connection.on('trap', function (e){
            adapter.log.debug('TRAP ' + JSON.stringify(e));
            err(e);
        });
        connection.on('timeout', function (e){
            err(e);
        });
        connection.on('error', function (e){
            err(e);
        });
    }
}
var flag = false;
function ch1(cb){
    _con.write('/system/resource/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            states.systeminfo = d[0];
            adapter.log.debug('/system/resource/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        if(!flag){
            flag = true;
            ch.on('error', function (e, chan){
                //adapter.log.debug('Oops: ' + e);
            });
        }
    });
}

function ch2(cb){
    _con.write('/ip/firewall/nat/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            ParseNat(d);
            adapter.log.debug('/ip/firewall/nat/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        /*ch.once('error', function(e, chan) {
            err(e, true);
        });*/
    });
}

function ch3(cb){
    _con.write('/ip/dhcp-server/lease/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            ParseDHCP(d);
            adapter.log.debug('/ip/dhcp-server/lease/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        /*ch.once('error', function(e, chan) {
            err(e, true);
        });*/
    });
}

function ch4(cb){
    _con.write('/interface/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            ParseInterface(d);
            adapter.log.debug('/interface/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        /*ch.once('error', function(e, chan) {
            err(e, true);
        });*/
    });
}

function ch5(cb){
    _con.write('/ip/firewall/filter/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            ParseFilter(d);
            adapter.log.debug('/ip/firewall/filter/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        /*ch.once('error', function(e, chan) {
            err(e, true);
        });*/
    });
}

function ch6(cb){
    _con.write('/interface/wireless/registration-table/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            ParseWiFi(d);
            adapter.log.debug('/interface/wireless/registration-table/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        /*ch.once('error', function(e, chan) {
            err(e, true);
        });*/
    });
}

function ch7(cb){
    _con.write('/ip/address/print', function(ch) {
        ch.once('done', function(p, chan) {
            var d = MikroNode.parseItems(p);
            ParseWAN(d);
            adapter.log.debug('/ip/address/print' + JSON.stringify(d));
            if(cb){cb();}
        });
        /*ch.once('error', function(e, chan) {
            err(e, true);
        });*/
    });
}

function parse(){
    clearTimeout(_poll);
    _poll = setTimeout(function(){
        ch1(function (){
            ch2(function (){
                ch3(function (){
                    ch4(function (){
                        ch5(function (){
                            ch6(function (){
                                ch7(function (){
                                    SetStates();
                                });
                            });
                        });
                    });
                });
            });
        });
    }, poll_time);
}

function ParseNat(d, cb){
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
    states.nat = res;
    //cb();
}

function ParseFilter(d, cb){
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
    states.filter = res;
    //cb();
}

function ParseInterface(d, cb){
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
    states.interface = res;
    //cb();
}


function ParseWiFi(d, cb){
    var res = [];
    var name;
    states.lists.wifi_list = [];
    d.forEach(function(item, i) {
        name = '';
        if(d[i]["mac-address"]!== undefined){
            getNameWiFi(d[i]["mac-address"], function(n){
                name = n;
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
            "mac":   d[i]["mac-address"],
            "name":  name
        });
    });
    states.wireless = res;
    //cb();
}

function ParseDHCP(d, cb){
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
        if(d[i]["status"] !== 'waiting'){
            states.lists.dhcp_list.push(
                {
                    "ip":  d[i]["address"],
                    "mac": d[i]["mac-address"],
                    "name":  d[i]["host-name"] ? d[i]["host-name"] : ''
                });
        }
    });
    states.dhcp = res;
    //cb();
}

function ParseWAN(d, cb){
    var res = [];
    d.forEach(function(item, i){
        if (d[i][".id"] !== undefined){
            if(d[i]["interface"] === d[i]["actual-interface"]){
                states.systeminfo.wan = d[i]["address"];
            }
        }
    });
    //cb();
}

function SetStates(){
    Object.keys(states).forEach(function(key) {
        if(states[key].length !== undefined && key !== 'lists'){
            states[key].forEach(function(item, i) {
                Object.keys(states[key][i]).forEach(function(k) {
                    if(old_states[key][i] == undefined){
                        old_states[key].push({});
                    }
                    if (states[key][i][k] !== old_states[key][i][k]){
                        old_states[key][i][k] = states[key][i][k];
                        var ids = '';
                        if (states[key][i]['name'] !== undefined){
                            if (states[key][i]['server'] !== undefined){
                                ids = key + '.' + states[key][i]['server']  + '.' + states[key][i]['name'] + '.' + k;
                            } else {
                                ids = key + '.' + states[key][i]['name'] + '.' + k;
                            }
                        } else {
                            ids = key + '.id' + states[key][i]['id'] + '.' + k;
                        }
                        setObject(ids, states[key][i][k]);
                    }
                });
            });
        } else {
            if (key === 'lists'){
                Object.keys(states[key]).forEach(function(k) {
                    var ids = key + '.' + k;
                    setObject(ids, JSON.stringify(states[key][k]));
                });
            } else if (key === 'systeminfo'){
                Object.keys(states[key]).forEach(function(k) {
                    if (states[key][k] !== old_states[key][k]){
                        old_states[key][k] = states[key][k];
                        var ids = key + '.' + k;
                        setObject(ids, states[key][k]);
                    }
                });
            }
        }
    });
    parse();
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
    //adapter.subscribeStates('*');
}

function getNameWiFi(mac, cb){
    var res = mac;
    var n = 0;
    states.dhcp.forEach(function(item, i){
        if (states.dhcp[i]['mac-address'] === mac){
            res = states.dhcp[i]['name'];
        }
        n++;
        if(n === states.dhcp.length) {
            cb(res);
        }
    });
}

function err(e, er){
    if (e){
        e = e.toString();
        if (connect){
            adapter.log.error('Oops: ' + e);
        }
        if (~e.indexOf('cannot log in')){
            adapter.log.error('Error: ' + e + '. Incorrect username or password');
        }
        if (~e.indexOf('ECONNRESET') || ~e.indexOf('closed') || ~e.indexOf('ended') || ~e.indexOf('Timeout') && !er){
            connection.close();
            flag = false;
            clearTimeout(_poll);
            clearTimeout(timer);
            connect = false;
            _poll = null;
            adapter.log.error('Error socket: Reconnect after 15 sec...');
            adapter.setState('info.connection', false, true);
            timer = setTimeout(function() {
                clearTimeout(timer);
                main();
            }, 15000);
        }
    }
}

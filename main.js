"use strict";

var utils =    require(__dirname + '/lib/utils');
var adapter = utils.adapter('mikrotik');
var MikroNode = require('mikronode-ng');

var _poll, poll_time = 5000, connect = false, timer;
var connection = null;
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
        connection = null;
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
    connection.getConnectPromise().then(function(conn) {
        conn.getCommandPromise(set).then(function resolved(values) {
            adapter.log.info('SetCommand response: ' + JSON.stringify(values));
        }, function rejected(reason) {
            err(reason);
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
    var con = {
        "host" : adapter.config.host ? adapter.config.host: "192.168.1.11",
        "port" : adapter.config.port ? adapter.config.port: 8728,
        "login" : adapter.config.login ? adapter.config.login : "admin",
        "password" : adapter.config.password ? adapter.config.password : ""
    };
    if(con.host && con.port){
        connection = MikroNode.getConnection(con.host, con.login, con.password, {
            port:           con.port,
            timeout:        10,
            closeOnTimeout: true,
            closeOnDone:    false
        });
        connection.getConnectPromise().then(function (conn){
            adapter.log.info('MikroTik ' + conn.status + ' to: ' + conn.host);
            adapter.setState('info.connection', true, true);
            connect = true;
            poll(conn);
        });
    }
}

function poll(conn){
    var ch1, ch2, ch3, ch4, ch5, ch6, ch7;
    clearInterval(_poll);
    _poll = setInterval(function() {
        ch1 = conn.getCommandPromise('/system/resource/print');
        ch2 = conn.getCommandPromise('/ip/firewall/nat/print');
        ch3 = conn.getCommandPromise('/ip/dhcp-server/lease/print');
        ch4 = conn.getCommandPromise('/interface/print');
        ch5 = conn.getCommandPromise('/ip/firewall/filter/print');
        ch6 = conn.getCommandPromise('/interface/wireless/registration-table/print');
        ch7 = conn.getCommandPromise('/ip/address/print');
        Promise.all([ ch1, ch2, ch3, ch4, ch5, ch6, ch7 ]).then(function resolved(values) {
            adapter.log.debug('/system/resource/print' + JSON.stringify(values[0][0]) + '\n\n');
            adapter.log.debug('interface/wireless/registration-table' + JSON.stringify(values[1]) + '\n\n');
            adapter.log.debug('ip/dhcp-server/lease' + JSON.stringify(values[2]) + '\n\n');
            adapter.log.debug('interface' + JSON.stringify(values[3]) + '\n\n');
            adapter.log.debug('ip/firewall/filter' + JSON.stringify(values[4]) + '\n\n');
            adapter.log.debug('ip/firewall/nat' + JSON.stringify(values[5]) + '\n\n');
            adapter.log.debug('/ip/address/print' + JSON.stringify(values[6]) + '\n\n');
            states.systeminfo = values[0][0];
            ParseNat(values[1], function(){
                ParseDHCP(values[2], function (){
                    ParseInterface(values[3], function (){
                        ParseFilter(values[4], function (){
                            ParseWiFi(values[5], function (){
                                ParseWAN(values[6], function (){
                                    SetStates();
                                });
                            });
                        });
                    });
                });
            });
        }, function rejected(reason) {
            if(connection){
                err(reason);
            }
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
    cb();
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
    cb();
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
    cb();
}


function ParseWiFi(d, cb){
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
    states.wireless = res;
    cb();
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
        if(d[i]["host-name"]!== undefined && d[i]["status"] !== 'waiting'){
            states.lists.dhcp_list.push(
                {
                    "ip":  d[i]["address"],
                    "mac": d[i]["mac-address"]
                });
        }
    });
    states.dhcp = res;
    cb();
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
    cb();
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

function err(e){
    if (e){
        e = e.toString();
        if (connect){
            adapter.log.error('Oops: ' + e);
        }
        if (~e.indexOf('ECONNRESET') || ~e.indexOf('closed') || ~e.indexOf('ended')){
            clearInterval(_poll);
            clearTimeout(timer);
            connect = false;
            connection.close();
            connection = null;
            _poll = null;
            adapter.log.error('Error socket: Reconnect after 15 sec...');
            adapter.setState('info.connection', false, true);
            timer = setTimeout(function() {
                main();
            }, 15000);
        }
    }
}
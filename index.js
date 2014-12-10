var util = require("util");
var events = require('events');

var Parser = module.exports = function () {
    if (!(this instanceof Parser)) {
        return new Parser();
    }
    events.EventEmitter.call(this);
    this.buffer = [];
};

util.inherits(Parser, events.EventEmitter);

// Commands that have names that we care about
var msg = Parser.msg = {
    noteOff: 0x80, // 128 - 143
    noteOn: 0x90, // 144 - 159
    polyAT: 0xA0, // 160 - 175
    ctrlChg: 0xB0, // 176 - 191
    progChg: 0xC0, // 192 - 207
    chanAT: 0xD0, // 208 - 223
    pitchBend: 0xE0, // 224 - 239

    startSysEx: 0xF0, // 240
    timeCode: 0xF1, // 241
    songPos: 0xF2, // 242
    songSel: 0xF3, // 243
    tuneReq: 0xF6, // 246
    endSysEx: 0xF7, // 247
    timingClock: 0xF8, // 248

    start: 0xFA, // 250
    continue: 0xFB, // 251
    stop: 0xFC, // 252
    activeSens: 0xFE, // 254
    systemReset: 0xFF // 255
};

// Commands that have a specified lengths for their data
// I wish there were actual rules around this
var msgLength = Parser.msgLength = {};
msgLength[msg.timeCode]         = 1;
msgLength[msg.timingClock]      = 1;
msgLength[msg.songPos]          = 2;
msgLength[msg.songSel]          = 1;
msgLength[msg.tuneReq]          = 0;
msgLength[msg.start]            = 0;
msgLength[msg.continue]         = 0;
msgLength[msg.stop]             = 0;
msgLength[msg.activeSens]       = 0;
msgLength[msg.systemReset]      = 0;
msgLength[msg.noteOff]          = 2;
msgLength[msg.noteOn]           = 2;
msgLength[msg.polyAT]           = 2;
msgLength[msg.ctrlChg]          = 2;
msgLength[msg.progChg]          = 1;
msgLength[msg.chanAT]           = 1;
msgLength[msg.pitchBend]        = 2;

// Make hash for generating message-related events
var msgEventName = Parser.msgEventName = {};
msgEventName[msg.timeCode]      = 'time-code';
msgEventName[msg.timingClock]   = 'timing-clock';
msgEventName[msg.songPos]       = 'song-pointer';
msgEventName[msg.songSel]       = 'song-select';
msgEventName[msg.tuneReq]       = 'tune-request';
msgEventName[msg.start]         = 'start';
msgEventName[msg.continue]      = 'continue';
msgEventName[msg.stop]          = 'stop';
msgEventName[msg.systemReset]   = 'system-reset';
msgEventName[msg.activeSens]    = 'active-sensing';
msgEventName[msg.noteOff]       = 'note-off';
msgEventName[msg.noteOn]        = 'note-on';
msgEventName[msg.polyAT]        = 'poly-at';
msgEventName[msg.ctrlChg]       = 'control-change';
msgEventName[msg.progChg]       = 'program-change';
msgEventName[msg.chanAT]        = 'channel-at';
msgEventName[msg.pitchBend]     = 'pitch-bend';

function channelCmd(byt) {
    return byt >= 0x80 && byt <= 0xEF;
}

function dataLength(cmd) {
    if (channelCmd(cmd)) {
        cmd = cmd & 0xF0;
    }
    // if we don't know how many data bytes we need assume 2
    return msgLength.hasOwnProperty(cmd) ? msgLength[cmd] : 2;
}

function systemRealTimeByte(byt) {
    return ( byt >= 0xF8 && byt <= 0xFF ) || byt == Parser.msg.timeCode;
}

function commandByte(byt) {
    return byt >= 128;
}

Parser.prototype.write = function (data) {
    for (var i = 0; i < data.length; i++) {
        this.writeByte(data[i]);
    }
};

Parser.prototype.writeByte = function (byt) {

    if (systemRealTimeByte(byt)) {
        return this.emitMidi([byt]);
    }

    var isCommandByte = commandByte(byt);

    // if we`re not in a command and we receive data we've probably lost
    // it someplace and we should wait for the next command
    if (this.buffer.length === 0 && !isCommandByte) {
        this.emit('lost-byte', byt);
        return;
    }

    if (this.buffer[0] === msg.startSysEx) {
        // emit commands
        if (byt === msg.endSysEx) {
            this.emitSysEx(this.buffer.slice(1));
            this.buffer.length = 0;
            return;
        }

        // Store data
        if (!isCommandByte) {
            return this.buffer.push(byt);
        }

        // Clear the buffer if another non realtime command was started
        if (isCommandByte) {
            this.buffer.length = 0;
        }

    }

    this.buffer.push(byt);

    // once we have enough data bytes emit the cmd
    if (dataLength(this.buffer[0]) === (this.buffer.length - 1)) {
        this.emitMidi(this.buffer.slice());
        this.buffer.length = 0;
    }

};

Parser.prototype.emitMidi = function (byts) {

    var cmd = byts[0],
        channel = null,
        data = byts.slice(1);

    if (channelCmd(cmd)) {
        cmd = cmd & 0xF0;
        channel = byts[0] & 0x0F;
    }

    // Get midi event name (if known)
    var eventName = msgEventName.hasOwnProperty(cmd) ? msgEventName[cmd] : 'midi-unknown';

    // Emit message-related event
    return this.emit(eventName, channel, data);

    // Emit common event
    //return this.emit('midi', cmd, channel, data);
};

Parser.prototype.emitSysEx = function (byts) {
    this.emit('sysex', byts[0], byts.slice(1));
};

Parser.encodeValue = function (buffer) {
    var encoded = [];
    for (var i = 0; i < buffer.length; i += 1) {
        encoded.push(buffer[i] & 0x7F); // The bottom 7 bits of the byte LSB
        encoded.push(buffer[i] >> 7 & 0x7F); // The top 1 bit of the byte MSB
    }

    return new Buffer(encoded);
};

Parser.encodeString = function (buffer) {
    var encoded = [];
    if (typeof buffer === 'string') {
        buffer = new Buffer(buffer, 'ascii');
    }
    return Parser.encodeValue(buffer);
};

Parser.decodeValue = function (buffer) {
    var decoded = [];
    for (var i = 0; i < buffer.length - 1; i += 2) {
        var _char = (buffer[i] & 0x7F) | (buffer[i + 1] << 7);
        decoded.push(_char);
    }
    return new Buffer(decoded);
};

Parser.decodeString = function (buffer) {
    return Parser.decodeValue(buffer).toString('ascii');
};

var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');

function CommandConfigure() {
  Command.call(this, 'configure');
}

util.inherits(CommandConfigure, Command);

CommandConfigure.prototype.execute = function() {

};

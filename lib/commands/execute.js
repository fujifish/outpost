var util = require('util');
var fs = require('fs');
var path = require('path');
var npm = require('npm');
var Command = require('../command');

function CommandExecute() {
  Command.call(this, 'execute');
}

util.inherits(CommandExecute, Command);

CommandExecute.prototype.execute = function() {

};

var util = require('util');
var fs = require('fs');
var path = require('path');
var child = require('child_process');
var Command = require('../command');

function CommandUnregister() {
  Command.call(this);
}

util.inherits(CommandUnregister, Command);

CommandUnregister.prototype.execute = function() {
  var _this = this;
  this._process(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandUnregister.prototype._process = function(cb) {
  var _this = this;
  var fortitude = this.outpost.fortitude;

  fortitude.unregister(function(err, response) {
    if (err) {
      cb('error', err);
      return;
    }

    cb('success', 'unregistered successfully');
  });
};

exports = module.exports = CommandUnregister;
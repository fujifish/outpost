var util = require('util');
var fs = require('fs');
var path = require('path');
var Command = require('../command');

function CommandSync() {
  Command.call(this);
}

util.inherits(CommandSync, Command);

CommandSync.prototype.execute = function() {
  var _this = this;
  this._process(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandSync.prototype._process = function(cb) {
  var homebase = this.outpost.homebase;

  // get the current state to send to homebase
  this.state.current(function(err, state) {
    if (err) {
      cb(err);
      return;
    }

    homebase.sync(state, function(err, response) {
      // TODO:
    });

  });

};

exports = module.exports = CommandSync;
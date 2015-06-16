var util = require('util');
var fs = require('fs');
var path = require('path');
var Command = require('../command');

function CommandUpdate() {
  Command.call(this);
}

util.inherits(CommandUpdate, Command);

CommandUpdate.prototype.execute = function() {
  var _this = this;
  this._process(function(result, msg) {
    _this.complete(result, msg);
  });
};

CommandUpdate.prototype._process = function(cb) {

  if (!this.command.version) {
    cb('error', 'outpost version not specified');
    return;
  }

  // check if this is the current version already
  var currentVersion = require('../package.json').version;
  if (currentVersion === this.command.version && !this.command.force) {
    cb('skipped', 'version already installed');
    return;
  }

  var _this = this;
  var newVersion = 'outpost@'+this.command.version;
  this.logger.debug('updating to outpost version ' + newVersion);

  var targetDir = path.resolve(_this.config.root, module.fullname);
  this.cache.download(newVersion, this.command.force, function(err, module) {
    if (err) {
      cb('error', err);
      return;
    }

    // extract the downloaded version to the root directory
    _this.cache.unpack(newVersion, targetDir, function(err) {
      if (err) {
        cb('error', 'update failed: unpack error: ' + err);
        return;
      }

      // perform the update
      var outpostCurrentDirName = path.resolve(_this.config.root, 'outpost-current');
      var realCurrentDir = path.resolve(__dirname, '../..');

      // make sure the directory we are running from is named correctly
      if (outpostCurrentDirName !== realCurrentDir) {
        cb('error', 'cannot update: not running from outpost-current');
        return;
      }

      // invoke the updater script
      process.nextTick(function() {
        var outFile = fs.openSync(_this.outpost.logFile, 'a');
        var errFile = fs.openSync(_this.outpost.logFile, 'a');
        var updater = child.spawn(
          process.execPath,
          ['lib/updater.js', _this.outpost.config.root, currentVersion, newVersion],
          { cwd: path.resolve(realCurrentDir, '..'),
            env: null,
            stdio: ['ignore', outFile, errFile],
            detached: true
          }
        );
        updater.unref();
      });
      cb('success');
    });
  });
  
};

exports = module.exports = CommandUpdate;
var util = require('util');
var fs = require('fs');
var npm = require('npm');
var Command = require('../command');

function CommandInstall() {
  Command.call(this, 'install');
}

util.inherits(CommandInstall, Command);

CommandInstall.prototype.execute = function() {
  var args = this.command.args;
  var _this = this;
  var npmConfig = {
    cache: this.command.config.modules,
    'fetch-retries': 2
  };
  npm.load(npmConfig, function (err) {
    if (err) {
      _this.complete('error', 'error loading npm config: ' + err);
      return;
    }
    _this.logger.info('downloading package ' + args.package);
    npm.commands.cache.add(args.package, null, null, null, function(err, data) {
      if (err) {
        _this.complete('error', 'error downloading package ' + args.package + ': ' + err);
        return;
      }
      _this.logger.info('downloaded package ' + args.package + '. unpacking.');
      var targetDir = _this.command.config.modules + '/' + data.name + '/' + data.version + '/package';
      npm.commands.cache.unpack(data.name, data.version, targetDir, function(err) {
        if (err) {
          _this.complete('error', 'error unpacking package ' + args.package + ': ' + err);
          return;
        }
        _this.logger.info('unpacked package ' + args.package + '. running install script.');

        var scriptName = targetDir + '/install.js';
        fs.exists(scriptName, function(exists) {
          if (!exists) {
            _this.complete('success');
            return;
          }
          try {
            var script = require(scriptName);
            script(args.installArgs, function(err, result) {
              if (err) {
                _this.complete('error', 'error running install script for package ' + args.package + ': ' + err);
                return;
              }
              _this.complete(result || 'success');
            });
          } catch (e) {
            _this.complete('error', 'exception running install script for package ' + args.package + ': ' + err);
          }
        });
      })
    });
  })
};

exports = module.exports = CommandInstall;

var util = require('util');
var fs = require('fs');
var path = require('path');
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
        _this.logger.info('unpacked package ' + args.package);
        _this._install(targetDir, args);
      })
    });
  })
};

CommandInstall.prototype._install = function(targetDir, args) {
  var _this = this;
  if (args.script) {
    var scriptName = path.resolve(targetDir, args.script);
    _this.logger.info('running install script ' + scriptName);
    fs.exists(scriptName, function(exists) {
      if (!exists) {
        _this.complete('error', 'install script ' + scriptName + ' does not exist');
        return;
      }

      try {
        var childProcess = require('child_process');
        var scriptRunner = childProcess.fork(path.resolve('lib/script.js'), (args.installArgs || []), {env: {outpostScript: scriptName}, cwd: targetDir});
        var result;
        var scriptTimeout = null;

        function complete(result, message) {
          scriptRunner.removeAllListeners();
          clearTimeout(scriptTimeout);
          _this.complete(result, message);
        }

        function terminate(result, message) {
          scriptRunner.kill('SIGKILL');
          complete(result, message);
        }

        function renewScriptTimeout() {
          clearTimeout(scriptTimeout);
          scriptTimeout = setTimeout(function() {
            terminate('timeout')
          }, 60 * 1000);
        }

        scriptRunner.on('message', function(message) {
          if (message.err) {
            terminate('error', 'error running install script for package ' + args.package + ': ' + message.err);
            return;
          }

          if (message.result) {
            complete(message.result);
            return;
          }

          if (message.progress) {
            renewScriptTimeout();
          }

          if (message.log) {
            _this.logger.info(message.log);
            renewScriptTimeout();
          }

        });

        scriptRunner.on('error', function(err) {
          terminate('error', 'error running install script for package ' + args.package + ': ' + err);
        });

        scriptRunner.on('exit', function(code, signal) {
          if (code !== 0) {
            result = 'abnormal termination (signal ' + signal + ')';
          }

          if (result === null) {
            result = 'missing result';
          }

          complete(result);
        });

      } catch (e) {
        _this.logger.error(e);
        complete('error', 'exception running install script for package ' + args.package + ': ' + e.message);
      }
    });
  } else {
    this.logger.info('package ' + args.package + ' has no install script');
    this.complete('success');
  }
};

exports = module.exports = CommandInstall;

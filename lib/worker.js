var cluster = require('cluster');
var Logger = require('./logger');
var Manifest = require('./manifest');

/**
 * Perform a command in a worker process
 * @param command the command data to execute
 * @param cb callback to invoke upon completion
 */
function work(command, cb) {
  var logger = new Logger('outpost:worker');
  command.outpost.manifest = new Manifest(command.outpost.config);
  var CommandClass = require('./commands/' + command.type);
  var commandObj = new CommandClass();
  commandObj.on('complete', function(result) {
    cb({event: 'complete', id: command.id, result: result});
  });
  command.outpost.manifest.load(function(err) {
    if (err) {
      logger.error('error loading manifest');
      cb({event: 'complete', id: command.id, result: {result: 'error', details: 'error loading manifest'}});
      return;
    }
    commandObj.run(command);
  });
}

exports = module.exports = work;

if (cluster.isWorker) {
  var command = JSON.parse(process.env.command);
  command.outpost = {};
  command.outpost.config = JSON.parse(process.env.config);
  command.outpost.monitor = {
    monitor: function(module, info) {
      process.send({monitor: info, module: module});
    },
    unmonitor: function(info) {
      process.send({unmonitor: info});
    }
  };
  work(command, function(event) {
    process.send(event);
    setImmediate(function() {
      process.exit(event.result.result === 'success' ? 0 : 1);
    });
  });
}


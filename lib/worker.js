var cluster = require('cluster');
var Logger = require('./logger');
var Manifest = require('./manifest');

/**
 * Perform a command in a worker process
 * @param command
 * @param onComplete
 */
function work(command, onComplete) {
  var logger = new Logger('outpost:worker');
  command.outpost.manifest = new Manifest(command.outpost.config);
  var CommandClass = require('./commands/' + command.type);
  var commandObj = new CommandClass();
  commandObj.on('complete', function(result) {
    onComplete({event: 'complete', id: command.id, result: result});
  });
  command.outpost.manifest.load(function(err) {
    if (err) {
      logger.error('error loading manifest');
      onComplete({event: 'complete', id: command.id, result: 'error'});
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
  work(command, function(result) {
    process.send(result);
    setImmediate(function() {
      process.exit(result.result.status === 'success' ? 0 : 1);
    });
  });
}


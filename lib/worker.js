var cluster = require('cluster');

/**
 * Perform a command in a worker process
 * @param command
 * @param onComplete
 */
function work(command, onComplete) {
  var CommandClass = require('./commands/' + command.type);
  var commandObj = new CommandClass();
  commandObj.on('complete', function(result) {
    onComplete({event: 'complete', id: command.id, result: result});
  });
  commandObj.run(command);
}

exports = module.exports = work;

if (cluster.isWorker) {
  var command = JSON.parse(process.env.command);
  work(command, function(result) {
    process.send(result);
    setImmediate(function() {
      process.exit(result.result.status === 'success' ? 0 : 1);
    });
  });
}


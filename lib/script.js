
// global outpost object with utility functions for running scripts
outpost = {
  log: function(message) {
    process.send({log: message});
  },

  progress: function() {
    process.send({progress: true});
  },

  done: function(result) {
    process.send({result: result || 'success'});
  },

  fail: function(message) {
    process.send({err: message});
    process.exit(0);
  }
};

var script = process.env['outpostScript'];
if (!script) {
  outpost.fail('script not specified');
}

// invoke the script
require(script);

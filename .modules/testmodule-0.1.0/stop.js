outpost.log('STOPPING');

outpost.unmonitor({name: 'test-server'}, function(err) {
  outpost.log('YAY! test-server stopped. err: ' + err);
  outpost.done();
});

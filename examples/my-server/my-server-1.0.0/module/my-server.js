var http = require('http');

var port = parseInt(process.argv[2]);

var server = http.createServer(function(req, res) {
  console.log('Got a new request');
  res.end('cool');
});

server.listen(port, function() {
  console.log('MyServer is listening on port ' + port);
});

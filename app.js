var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var Twit = require('twit');
var fs = require("fs");
var ws = require("ws");

var index = require('./routes/index');
var users = require('./routes/users');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', index);
app.use('/users', users);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// websocket
var http = require('http'),
    server =  http.createServer(),
    WebSocketServer = require('ws').Server,
    websocket,
    port = 8080;

var keys = JSON.parse(fs.readFileSync("keys.json").toString());
var params = JSON.parse(fs.readFileSync("params.json").toString());
var T = new Twit(keys);
var list=fs.readFileSync("words.txt").toString().split('\n');
var run=null;
var p=[];

/*
    Schedule:
    
    1. Post 3 random words to twitter
    2. wait from 1 or 2 hours to collect favs
    3. Play the most fav-ed word, tweet the selection, go to 1
*/

function initSocketConnection() {
	// WS connection
	try {
		websocket = new WebSocketServer({server:server});

		websocket.on("connection",function connection_fromInitSocketConnection(s) {
            console.log("Connection open");
			s.on('message',function message_fromInitSocketConnection(msg) {
                var data=JSON.parse(msg);
				switch(data.type) {
					case "echo":
						console.log("ECHO: '"+data.msg);
						break;
					case "tweet":
					    post3words().then(function(run) {
                            console.log("tweeted words:");
                            console.log(run);
                            
                            // collect favs for 1h, then play
                            setTimeout(function() {
                                get_favs().then(play);
                            }, 1000*60*5);
                        });
					    break;
					case "get_favs":
					    get_favs().then(function(favs) {
                            console.log("favs:");
                            console.log(favs);
					    });
					    break;
					case "play":
					    get_favs().then(function() {
					        play();
					    });
					    break;
				}
			});
			s.on('close',function close_fromInitSocketConnection(msg) {
			    console.log("Connection closing");
			});
		});
		server.listen(port, function _fromInitSocketConnection() {
		    console.log('Listening on ' + server.address().port,server.address());
		});
	} catch (ex) {
		console.log("ERROR: Unable to create a server",ex);
	}
}

function post3words() {
    var pr=new Promise(function(res,rej) {
       
        // Pick 3 words
        var words=[];
        for(var j=0;j<3;j++) {
            var i=parseInt(list.length*Math.random());
            words.push(list[i]);
        }
        console.log("selected words:");
        console.log(words);
    
        // Post to Twitter
        for(var j=0;j<3;j++) {
            (function(jj) {
            p[jj]=new Promise(function(resolve,reject) {
                var word=words[jj];
                var filePath = 'words/'+word+'.mp4';
                console.log(jj,filePath);
                T.postMediaChunked({ file_path: filePath }, function (err, data, response) {
                    console.log("posted media for tweet",jj);
                    if(err) {
                        console.error(err);
                    }
                
                    var mediaIdStr = data.media_id_string;
                    var params = {
                        status: 'Like this tweet to send @nata_dreams the word "'+word+'"\nMore information at http://dreamsessions.org',
                        media_ids: [mediaIdStr]
                    };
                    T.post('statuses/update', params, function (err, data, response) {
                        console.log("posted tweet",jj);
                        if(err) {
                            console.error(err);
                        }
                        resolve({word:word,id_str:data.id_str});
                    });
                });
            });
            })(j);
        }
        
        // Play the selected old word
        play();
        
        // Save the new words
        Promise.all(p)
            .then(function(values) { 
                run = {
                    timestamp:new Date(),
                    tweets:values
                };
                
                if(fs.existsSync("latest.json")) {
                    fs.renameSync("latest.json","latest_"+(new Date()).toString()+".json");
                    console.log('previous tweets renamed with play date');
                }
                
                fs.writeFileSync("latest.json",JSON.stringify(run));
                res(run);
            });
    
        /*
        var duration = wait();
        console.log("Will wait for ",duration," milliseconds");
        setTimeout(function() {
            post3words();
            play();
        },duration);
        */
    });
    return pr;
}

function get_favs() {
    var pr = new Promise(function(res,rej) {
        var latest = JSON.parse(fs.readFileSync("latest.json").toString());
        var p=[];
        for(var j=0;j<3;j++) {
            (function(jj) {
                p[jj] = new Promise(function(resolve,reject) {
                    T.get('statuses/show/:id', { id: latest.tweets[jj].id_str }, function (err, data, response) {
                        resolve(data.favorite_count);
                    });
                });
            })(j);
        }

        Promise.all(p)
            .then(function(values) {
                latest.tweets[0].favs=values[0];
                latest.tweets[1].favs=values[1];
                latest.tweets[2].favs=values[2];
                fs.writeFileSync("latest.json",JSON.stringify(latest));
                res(latest);
            });
    });
    return pr;
}

function play() {
    var latest = JSON.parse(fs.readFileSync("latest.json").toString());
    var msg = {
        type: 'play',
        msg: latest
    };
    var n=0;

    websocket.clients.forEach(function each(client) {
        client.send(JSON.stringify(msg));
        n++;
    });
    console.log("Sent 'play' message to",n,"clients");
}

function wait() {
    return parseInt(2*60*60*1000 +1*60*60*1000*Math.random());
}

initSocketConnection();

// post3words();

//setTimeout(get_likes,10000);

module.exports = app;

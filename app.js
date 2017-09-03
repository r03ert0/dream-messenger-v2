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
var is_tweeting = false;
var delay = 1000*60*60;

/*
    Schedule:
    
    1. Post 3 random words to twitter
    2. wait from 1 or 2 hours to collect favs
    3. Play the most fav-ed word, tweet the selection, go to 1
*/

function initSocketConnection() {
    console.log('>> initSocketConnection');
	// WS connection
	try {
		websocket = new WebSocketServer({server:server});

		websocket.on("connection",function connection_fromInitSocketConnection(s) {
            console.log("Connection open");
            
            send_db(s);
            s.send(JSON.stringify({type:'is_tweeting',msg:is_tweeting}));
			
			s.on('message',function message_fromInitSocketConnection(msg) {
                var data=JSON.parse(msg);
				switch(data.type) {
					case "echo":
						console.log("ECHO: '"+data.msg);
						break;
					case "tweet":
					    tweet();
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
					case "is_tweeting":
					    s.send(JSON.stringify({type:'is_tweeting',msg:is_tweeting}));
					    break;
					case "do_tweet":
					    is_tweeting = data.msg;
					    if(is_tweeting) {
					        console.log("DO TWEET");
					    } else {
					        console.log("DO NOT TWEET");
					    }
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

function send_db(s) {
    console.log('>> send_db');
    var arr = fs.readdirSync('.');
    var arr2=[];
    for(var f in arr) {
        if(arr[f].slice(0,6)=="latest") {
            var lat = JSON.parse(fs.readFileSync(arr[f]).toString());
            arr2.push(lat);
        }
    }
    s.send(JSON.stringify({type:'db',msg:arr2}));
}

function tweet() {
    post3words().then(function(run) {
        console.log("tweeted words:");
        console.log(run);
        console.log("The selected word will be played at",new Date((new Date()).getTime()+(new Date(delay)).getTime()));

        // collect favs for 2h, then play
    
        setTimeout(function() {
            get_favs(run)
                .then(function(run2) {
                    play(run2);
                    if(is_tweeting) {
                        tweet();
                    }
                });
        }, delay);
    });
}
function post3words() {
    console.log('>> post3words');
    var pr=new Promise(function(res,rej) {

        if(!is_tweeting) {
            console.log("WARNING: was asked to tweet, but tweeting is turned OFF.");
            rej();
            return;
        }

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
                        status: 'Like this tweet to send @nata_dreams the word "'+word+'"\n#101nights\nMore info at http://dreamsessions.org',
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
        
        // Save the new words
        Promise.all(p)
            .then(function(values) { 
                run = {
                    timestamp_tweeted:new Date(),
                    tweets:values
                };
                
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

function get_favs(run) {
    console.log('>> get_favs');
    var pr = new Promise(function(res,rej) {
        var p=[];
        for(var j=0;j<3;j++) {
            (function(jj) {
                p[jj] = new Promise(function(resolve,reject) {
                    T.get('statuses/show/:id', { id: run.tweets[jj].id_str }, function (err, data, response) {
                        resolve(data.favorite_count);
                    });
                });
            })(j);
        }

        Promise.all(p)
            .then(function(values) {
                run.tweets[0].favs=values[0];
                run.tweets[1].favs=values[1];
                run.tweets[2].favs=values[2];
                fs.writeFileSync("latest.json",JSON.stringify(run));
                res(run);
            });
    });
    return pr;
}

function play(run) {
    console.log('>> play');
    if(!run) {
        if(fs.existsSync("latest.json")) {
            run = JSON.parse(fs.readFileSync("latest.json").toString());
        } else {
            return;
        }
    }
    
    // select word to play
    var j,maxfav=0;
    var arr=[];
    for(j=0;j<3;j++) {
        if(run.tweets[j].favs>maxfav) {
            maxfav=run.tweets[j].favs;
        }
    }
    for(j=0;j<3;j++) {
        if(run.tweets[j].favs==maxfav) {
            arr.push({tweet: run.tweets[j], index: j});
        }
    };
    var selected=arr[parseInt(Math.random()*(arr.length))].index;
    run.tweets[selected].selected=true;
    
    // set play timestamp
    var played_date = new Date();
    run.timestamp_played=played_date;
    
    // send play message to client
    var msg = {
        type: 'play',
        msg: run
    };
    var n=0;
    fs.writeFileSync("latest_"+played_date.toString()+".json",JSON.stringify(run));
    console.log('previous tweets renamed with play date');

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

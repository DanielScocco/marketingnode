"use strict";

var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var MongoClient = require('mongodb').MongoClient;
var bcrypt = require ('bcrypt');
var cookieParser = require('cookie-parser');
var http = require('http');
var nodemailer = require('nodemailer');
var sanitizer = require('sanitizer');

app.set('view engine','pug');
app.set('views','./views');
app.locals.pretty = true; //output pretty html

app.use(express.static(__dirname + '/public')); 
app.use(bodyParser.urlencoded({extended:true})); 
app.use(cookieParser()); 

var db;

MongoClient.connect('mongodb://',function(err,database){
    if(err)
        throw err;
    db = database;    
});

app.post('/postRequest',function(req,res){
    var providedTitle = req.body.title;
    var providedUrl = req.body.url;
    var cookieId = req.cookies.id;
    
    //sanitize
    providedTitle = sanitizer.sanitize(providedTitle);
    providedUrl = sanitizer.sanitize(providedUrl);

    db.collection('users').find({cookie:cookieId}).toArray(function (err,result){
        if(err)
            throw err;
        if(result.length){
            var points = result[0].points;
            if(points>9){
                var userId = result[0]._id;
                points -= 10;
                //subtract 10 points
                db.collection('users').update({_id:userId},{$set:{'points':points,'novice':0}},function(err,result){
                    if(err)
                        throw err;
                });
                //post request to db and redirect
                var email = result[0].email;
                var request = {userEmail:email,title:providedTitle,url:providedUrl,links:0};
                db.collection('requests').save(request,function(err,result){
                    res.redirect('/members/?req=success');
                });
            }
            //not enough points
            else{
                var data = {pointsErr:true};
                res.redirect('/members/?err=points');
            }
        }
        //couldn't find user
        else{
            res.redirect('/');
        }
    });
});

app.post('/earnPoints',function(req,res){
    var providedUrl = req.body.url;
    var cookieId = req.cookies.id;

    //sanitize
    providedUrl = sanitizer.sanitize(providedUrl);

    console.log("---> earnPoints request: "+providedUrl);

    db.collection('users').find({cookie:cookieId}).toArray(function(err,result){
        if(err) throw err;
        if(result.length){
            var currentPoints = result[0].points;
            var userId = result[0]._id;
            //store URL
            var userEmail = result[0].email;
            var submission = {url:providedUrl,email:userEmail};
            db.collection('submissions').save(submission,function(err,result){
                if(err) throw err;
            });
            
            //check if URL has a link to latest X requests
            var providedHost,providedPath;
            var start = providedUrl.indexOf('//');
            var removedHttp = providedUrl.substring(start+2); 
            var splitArray = removedHttp.split(/\/(.+)/);
            if(splitArray.length<2){
                providedHost = splitArray[0];
                providedPath = '/';
                if(providedHost[providedHost.length-1]=='/')
                    providedHost = providedHost.substring(0,providedHost.length-1);    
            }
            else{
                providedHost = splitArray[0];
                providedPath = splitArray[1];
            }
            var options = {host:providedHost,path:providedPath};
            http.get(options,function(http_res){
                var data = "";
                http_res.on("data",function(chunk){
                    data += chunk;
                });
                http_res.on("end",function(){
                    db.collection('requests').find().sort({_id:-1}).limit(20).toArray(function(err,requestResults){
                        if(err) throw err;
                        //create array with all URLs
                        var urlsArray = [];
                        var emailsArray = [];
                        for(var i=0;i<requestResults.length;i++){
                            urlsArray.push(requestResults[i].url);
                            emailsArray.push(requestResults[i].userEmail);
                        }
                        //collect all the links on the page
                        var linksArray = [];
                        var index,endQuotes,quoteChar;
                        while((index=data.indexOf('href='))!=-1){
                            quoteChar = data[index+5];
                            data = data.substring(index+6);
                            endQuotes = data.indexOf(quoteChar);
                            linksArray.push(data.substring(0,endQuotes));
                            data = data.substring(endQuotes+1);
                        }
                        //check how many links match
                        var newPoints = 0;
                        for(var i=0;i<linksArray.length;i++){
                            for(var j=0;j<urlsArray.length;j++){
                                if(minEditDistance(linksArray[i],urlsArray[j])<2){
                                    newPoints+=5;
                                    //send email notification to receiver
                                    var emailObj = {'to':emailsArray[j],'subject':'You received a new link!','text':'Hi there,\n\nOne of our members just linked to your request. You can find your link here:\n\n'+providedUrl+'\n\nBest wishes,\r\nMarketing Node\r\nhttps://marketingnode.com'};
                                    sendEmail(emailObj);
                                    console.log("---> link match "+emailObj);
                                }
                            }
                        }
                        console.log
                        //update user points
                        currentPoints += newPoints;
                        db.collection('users').update({_id:userId},{$set:{points:currentPoints}},function(err,result){
                            if(err) throw err;
                        });                
                        //redirect
                        res.redirect('/members/?gained='+newPoints);
                    });
                });
            });
        }
        else{
            res.redirect('/');
        }
    });
});

app.post('/signup',function(req,res){
    //check if referral is valid
    var ref = req.body.referral;
    ref = sanitizer.sanitize(ref);

    db.collection('users').find({email:ref}).toArray(function(err,result){
        //referral is valid, signup user
        if(result.length){
            var salt = bcrypt.genSaltSync(10);
            var hash = bcrypt.hashSync(req.body.pass,salt);

            //set cookie on browser and db
            var rand = randomString();
            res.cookie('id',rand,{maxAge:900000000000,httpOnly:true});
            
            var providedEmail = req.body.email;
            providedEmail = sanitizer.sanitize(providedEmail);

            var user = {referral:ref,email:providedEmail,pass:hash,cookie:rand,points:10,novice:1};

            db.collection('users').save(user,function(err,result){
                if(err)
                    throw err;
                console.log('---> New user signup');
                res.redirect('/members/');
            });
        } 
        //referral invalid
        else{
            res.redirect('/?err=ref');
        }
    });
});

app.get('/',function(req,res) {
    //check if logged, if so redirect, else return index.html
    var cookieId = req.cookies.id;
    db.collection('users').find({cookie:cookieId}).toArray(function(err,result){
        if(err)
            throw err;
        if(result.length){
            res.redirect('/members/');
        }
        //not logged, display index.html
        else{
            var data = {refError:false,usrError:false};
            if(req.query['err']=='ref')
                data.refError = true;
            if(req.query['err']=='usr')
                data.usrError = true;
	        res.render('index',data);
       }
    });
});

app.get('/members',function(req,res){
    //check if logged, else redirect
    var cookieId = req.cookies.id;
    db.collection('users').find({cookie:cookieId}).toArray(function(err,result){
        if(err)
            throw err;
        if(result.length){
            //get list of requests
            db.collection('requests').find().sort({_id:-1}).limit(20).toArray(function(err,requestResults){
                if(err)
                    throw err;
                var reqArray = {};
                for(var i=0;i<(requestResults.length);i++){
                    reqArray[requestResults[i].title] = requestResults[i].url;
                }
                var userEmail = result[0].email;
                var userPoints = result[0].points;
                var novice,noPoints,reqSuccess,gainedPoints,totalPoints;
                if(req.query['gained']){
                    gainedPoints = true;
                    totalPoints = req.query['gained'];
                }
                else{
                    gainedPoints = false;
                    totalPoints = 0;
                }
                if(req.query['req']=='success')
                    reqSuccess = true;
                else
                    reqSuccess = false;
                if(req.query['err']=='points')
                    noPoints = true;
                else
                    noPoints = false;
                if(result[0].novice==1)
                    novice = true;
                else
                    novice = false;
                var data = {email:userEmail,points:userPoints,showInfo:novice,pointsErr:noPoints,success:reqSuccess,requests:reqArray,showGain:gainedPoints,newPoints:totalPoints};
        	    res.render('members',data);
            });
        }
        else{
            res.redirect('/');
        }
    });
});

app.post('/login',function(req,res){
    var providedEmail = req.body.email;
    var providedPass = req.body.pass;

    //sanitize
    providedEmail = sanitizer.sanitize(providedEmail);
    providedPass = sanitizer.sanitize(providedPass);

    //check user and pass
    db.collection('users').find({email:providedEmail}).toArray(function(err,result){
        if(err)
            throw err;
        if(result.length){
            var hash = result[0].pass;
            if(bcrypt.compareSync(providedPass,hash)){
                var rand = randomString();
                res.cookie('id',rand,{maxAge:900000000000,httpOnly:true});
                
                db.collection('users').update({email:providedEmail},{$set:{cookie:rand}},function(err,result){
                    if(err)
                        throw err;
                    res.redirect('/members/');
                });
            }
            else{
                res.redirect('/?err=usr');
            }    
        }
        else{
            res.redirect('/?err=usr');
        }
    });    
});


app.get('/logout',function(req,res){
    //remove cookie from db
    var cookieId = req.cookies.id;
    db.collection('users').update({cookie:cookieId},{$set:{cookie:''}},function(err,updated){
        if(err)
            throw err;
    });
    //remove cookie from browser
    res.clearCookie('id');
    res.redirect('/');
});

app.get('/terms',function(req,res){
    res.render('terms');
});

app.get('*',function(req,res){
	res.status(404);
	res.render('404');
});

app.listen(process.env.PORT || 3000,function(){
        console.log('App Listening on port 3000');
});
//sends email via sendgrid
function sendEmail(email){
    var transporter = nodemailer.createTransport('smtps://@smtp.sendgrid.net');
    var mailOptions = {
        from: '',
        to: email.to,
        subject: email.subject,
        text: email.text};
    transporter.sendMail(mailOptions,function(err,info){
        if(err){
            console.log(err);
            throw err; 
        }
        console.log('---> sendgrid: '+info.response);
    });
}
//returns a random 30-char string
function randomString(){
    var d = new Date();
    var string1 = ""+d.getTime();
    string1 = string1.substring(0,10);

    var string2 = "";
    for(var i=0;i<10;i++){
        string2 += Math.floor(Math.random() * 20);
    }
    string2 = string2.substring(0,10);


    var string3 = "";
    var n = d.getMilliseconds();
    for(var i=0;i<10;i++){
        var random = Math.floor(Math.random()*10);
        var n = d.getMilliseconds();
        string3 += (random * n)
    }

    string3 = string3.substring(0,10);

    return string1+string2+string3;
}

function minEditDistance(a, b){
  if(a.length == 0) return b.length;
  if(b.length == 0) return a.length;

  var matrix = [];

  // increment along the first column of each row
  var i;
  for(i = 0; i <= b.length; i++){
    matrix[i] = [i];
  }

  // increment each column in the first row
  var j;
  for(j = 0; j <= a.length; j++){
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for(i = 1; i <= b.length; i++){
    for(j = 1; j <= a.length; j++){
      if(b.charAt(i-1) == a.charAt(j-1)){
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                Math.min(matrix[i][j-1] + 1, // insertion
                                         matrix[i-1][j] + 1)); // deletion
      }
    }
  }

  return matrix[b.length][a.length];
}

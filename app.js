const express = require("express")
const css = require("css")
const cookieParser = require("cookie-parser")
const sqlite = require("sqlite")
const multer = require("multer")
const sqlite3 = require("sqlite3")
const fsp = require("fs").promises
const svgCaptcha = require("svg-captcha")
const apiRouter = require('./app-router.js')
const path = require("path")
const cors = require("cors")
const app = express()
const PORT = 8081

let uploader = multer({ dest: 'uploads/' });
let captcha = svgCaptcha.create();
// console.log(captcha)
let db;

sqlite.open({
  filename: __dirname + '/bbs.db',
  driver: sqlite3.Database
}).then(value => {
  db = value;
})

app.use(cors())
app.locals.pretty = true;
app.set('views', __dirname + '/views')
app.use(express.static(__dirname + '/static'))
app.use('/uploads', express.static(__dirname + '/uploads'))
app.use(express.json())
app.use(express.urlencoded({extended: true}))
app.use(cookieParser('ah4bk5asd23tojg9as'))

let sessionStore = Object.create(null);

app.use(function sessionMW(req, res, next) {
  if(req.cookies.sessionId) {
    req.session = sessionStore[req.cookies.sessionId];
    if(!req.session) {
      req.session = sessionStore[req.cookies.sessionId] = {};
    }
  } else {
    let id = Math.random().toString(16).slice(2);
    
    req.session = sessionStore[id] = {};
    res.cookie('sessionId', {
      maxAge: 86400000
    })
  }
  next();
})

app.use(async (req, res, next) => {
  console.log(req.method, req.url);
  // console.log(req.signedCookies.user);
  //获取cookie是否已签名
  if(req.signedCookies.user) {
    //从签名的cookie中读出用户名将该用户信息存入req.user中以便后续使用
    req.user = await db.get('SELECT rowid as id, name, email, avatar FROM users WHERE name = ?', req.signedCookies.user);
  }
  // console.log(req.cookies, req.signedCookies);
  next();
})

app.use('/api', apiRouter)


//主页
app.get('/', async (req, res ,next) => {

  let posts = await db.all('SELECT postInfo.rowid AS id,* FROM postInfo JOIN users WHERE users.rowid = postInfo.ownerId');
  // console.log(posts);
  // console.log(req.user)
  res.render('index.pug', {
    user: req.user,
    posts: posts
  });
})

//登出
app.get('/logout', (req, res, next) => {
  res.clearCookie('user');
  res.redirect('/');
})

//帖子详情
app.get('/post/:id', async (req, res, next) => {
  // let post = postInfo.find(it => it.id == req.params.id);
  // console.log(post)
  // console.log(req.body)
  let post = await db.get(`SELECT postInfo.rowid AS id, 
  title, content, createAt, ownerId, name, avatar 
  FROM postInfo JOIN users 
  ON postInfo.ownerId = users.rowId 
  WHERE id = ?`, req.params.id);
  // let post = await db.get('select postInfo.rowid as id, * from postInfo join comments on id = comments.replyTo where id = ?', req.params.id);


  if(post) {
    // post.owner = users.find(it => it.id == post.ownerId);
    let comments = await db.all('SELECT * FROM comments JOIN users ON comments.replyTo = ? WHERE users.rowid = comments.ownerId ORDER BY comments.createAt ASC', req.params.id);

    let data = {
      post: post,
      comments: comments,
      user: req.user
    }
    res.render('post.pug', data);

  } else {
    res.status(404);
    res.render('404.pug');
  }
})

//提交回复评论
app.post('/comment', async (req, res, next) => {

  if(req.user) {
    let body = req.body;
    let date = new Date();
    await db.run('insert into comments values (?, ?, ?, ?)', [body.replyTo, req.user.id, body.content, date.toGMTString()]);

    res.redirect('post/' + body.replyTo);

  } else {
    // console.log(1);
    res.writeHead(401, {
      'Content-Type': 'text/html; charset=utf-8'
    })
    res.end('请先登录');
  }
})

//提交帖子页route
app.route('/write')
.get((req, res, next) => {
  res.render('write.pug');
})
.post(async (req, res, next) => {
  if(req.user) {
    
    let body = req.body;
    let date = new Date();

    await db.run('INSERT INTO postInfo VALUES (?, ?, ?, ?)', [body.title, body.content, req.user.id, date.toGMTString()]);
    
    let post = await db.get('SELECT rowid AS id FROM postInfo ORDER BY rowid DESC LIMIT 1');

    res.redirect('post/' + post.id);

  } else {
    res.writeHead(401, {
      'Content-Type': 'text/html; charset=utf-8'
    })
    res.end('请先登录');
    return
  }
})

//登录页route
app.route('/login')
.get((req, res, next) => {
  res.render('login.pug');
})
.post(async (req, res, next) => {
  let body = req.body;
  // console.log(body);

  if(req.body.captcha !== req.session.captcha) {
    res.json({
      code: 1,
      reason: '验证码错误'
    })
    return
  }

  var user = await db.get('SELECT * FROM users WHERE name = ? AND password = ?', [body.name, body.password]);

  // console.log(user);
  // let user = users.find(it => it.name === body.name && it.password === body.password);

  if(user) {
    // console.log(user.name);
    res.cookie('user', user.name, {
      maxAge: 86400000,
      signed: true
    });
    // console.log()
    res.json({
      code: 0,
      reason: '登录成功!将跳转到首页'
    })
  } else {
    res.json({
      code: 1,
      reason: '用户名或密码错误,请重新登录'
    })
  }
})

//验证码
app.get('/captcha', async (req, res, next) => {
  var captcha = svgCaptcha.create();
  req.session.captcha = captcha.text;
  
  res.type('svg');
  res.status(200).send(captcha.data);
})

//用户页
app.get('/person/:id', async(req, res, next) => {
  let exist = await db.get('select * from users where users.rowid = ?', req.params.id);
  if(exist) {
    if(req.user) {
      if(req.user.id == req.params.id) {
        let main = await db.get('select rowid as id, name, email, avatar from users where rowid = ?', req.params.id);
        let posts = await db.get('select postInfo.rowid as postId, postInfo.title, postInfo.createAt from users join postInfo where users.rowid = postInfo.ownerId and users.rowid = ? ORDER BY postInfo.rowid DESC')
        let comments = await db.get('select comments.content as comment, postInfo.title, postInfo.rowid as postId from users join comments join postInfo where users.rowid = ? and users.rowid = comments.ownerId and comments.replyTo = postInfo.rowid ORDER BY comments.rowId DESC', req.params.id);
        res.render('person.pug', {
          code: 0,  //已登录，发送code0标识
          main: main,
          posts: posts,
          comments: comments
        })
      } else {
        let main = await db.get('select rowid as id, name, email, avatar from users where rowid = ?', req.params.id);
        let posts = await db.get('select postInfo.rowid as postId, postInfo.title, postInfo.createAt from users join postInfo where users.rowid = postInfo.ownerId and users.rowid = ? ORDER BY postInfo.rowid DESC');
        let comments = await db.get('select comments.content as comment, postInfo.title, postInfo.rowid as postId from users join comments join postInfo where users.rowid = ? and users.rowid = comments.ownerId and comments.replyTo = postInfo.rowid ORDER BY comments.rowId DESC', req.params.id);
        
        res.render('person.pug', {
          code: 0,
          main: main,
          posts: posts,
          comments: comments
        })
      }
    } else {
      let main = await db.get('select rowid as id, name, email, avatar from users where rowid = ?', req.params.id);
      let posts = await db.get('select postInfo.rowid as postId, postInfo.title, postInfo.createAt from users join postInfo where users.rowid = postInfo.ownerId and users.rowid = ? ORDER BY postInfo.rowid DESC');
      let comments = await db.get('select comments.content as comment, postInfo.title, postInfo.rowid as postId from users join comments join postInfo where users.rowid = ? and users.rowid = comments.ownerId and comments.replyTo = postInfo.rowid ORDER BY comments.rowId DESC', req.params.id);
      
      res.render('person.pug', {
        code: 1,  //未登录 发送code1标识
        main: main,
        posts: posts,
        comments: comments
      })
    }
  } else {
    res.status(404);
    res.render('404.pug');
  }
})

//注册页route
app.route('/register')
.get((req, res, next) => {
  res.render('register.pug');
})
.post(uploader.single('avatar'), async (req, res, next) => {
  // console.log(req.body)
  let body = req.body;
  let file = req.file;
  let avatarPath;
  if(file) {
    let newName = file.path + '-' + file.originalname;
    await fsp.rename(file.path, newName);
    avatarPath = '/uploads/' + path.basename(newName);
  } else {
    avatarPath = '/uploads/avatar.png';
  }


  try {
    let now = new Date();
    await db.run('insert into users values (?, ?, ?, ?)', [body.name, body.password, body.email, avatarPath]);
    res.render('register-result.pug', {
      code: 0,
      result: '注册成功!'
    })
  } catch(e) {
    res.render('register-result.pug', {
      code: 1,
      result: '注册失败' + e.toString()
    })
  }


  // body.createAt = Date.now();
})


app.listen(PORT, () => {
  console.log('listen on port', PORT);
})
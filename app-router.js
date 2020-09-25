const express = require('express')
const multer = require('multer')
const apiRouter = express.Router()
const fsp = require("fs").promises
const path = require("path")
let uploader = multer( {dest: 'uploads/'} )
const svgCaptcha = require("svg-captcha")


let db
const dbPromise = require('./bbs-db.js')
dbPromise.then(value => {
  db = value
})
module.exports = apiRouter

//首页总贴json
apiRouter.get('/posts', async (req, res, next) => {
  let posts = await db.all('SELECT postInfo.rowid AS id, postInfo.*, users.name, users.avatar FROM postInfo JOIN users WHERE users.rowid = postInfo.ownerId AND postInfo.active = 1 ORDER BY postInfo.lastComment DESC');
  res.json({
    posts,
    user: req.user
  })
  if(req.user) {
  } else {

  }
})
//单贴json
apiRouter.get('/post/:id', async (req, res, next) => {
  let post = await db.get(`SELECT postInfo.rowid AS id, 
  title, content, postInfo.createAt as createAt, lastComment, ownerId, name, avatar 
  FROM postInfo JOIN users 
  ON postInfo.ownerId = users.rowId 
  WHERE id = ? AND postInfo.active = 1`, req.params.id);
``
  if (post) {
    let comments = await db.all('SELECT comments.rowid as id, comments.*, name, email, avatar FROM comments JOIN users ON comments.replyTo = ? WHERE users.rowid = comments.ownerId AND comments.active = 1 ORDER BY comments.createAt ASC', req.params.id);
    var data = {
      post: post,
      comments: comments,
      user: req.user,
    }
    res.json(data)
  } else {
    res.status(404)
    res.end()
  }
})

//获取用户信息
apiRouter.get('/userInfo', async (req, res, next) => {
  if (req.user) {
    res.json({
      code: 0,
      user: req.user
    })
  } else {
    res.json({
      code: -1,
      msg: "未登录"
    })
  }
})

//验证码获取
apiRouter.get('/captcha', async (req, res, next) => {
  var captcha = svgCaptcha.create();
  req.session.captcha = captcha.text;
  
  res.type('svg');
  res.status(200).send(captcha.data);
})

//用户登录
apiRouter.post("/login", async (req, res, next) => {
  let body = req.body;

  if (req.body.captcha !== req.session.captcha) {
    res.json({
      code: -1,
      msg: '验证码错误,请重新输入'
    })
    return
  }

  var user = await db.get('SELECT rowid as id, name, email, avatar FROM users WHERE name = ? AND password = ?', [body.name, body.password]);

  if (user) {
    res.cookie('user', user.name, {
      maxAge: 86400000,
      signed: true
    });
    res.json({
      code: 0,
      user: user
    })
  } else {
    res.json({
      code: -1,
      msg: '用户名或密码错误,请重新输入'
    })
  }
})
//登出
apiRouter.get('/logout', (req, res, next) => {
  res.clearCookie('user');
  res.end();
})


//重名检测
apiRouter.post('/conflict/name', async (req, res, next) => {
  let body = req.body;
  if(!body.name) {
    res.json({
      code: -1,
      msg: '用户名不能为空'
    })
  }
  if(body.name) {
    let dbName = await db.get('SELECT * FROM users WHERE name = ?', body.name);
    if(dbName) {
      res.json({
        code: -1,
        msg: '此用户名已被占用'
      })
    } else {
      res.json({
        code: 0,
        msg: '此用户名可用'
      })
    }
  }
})

//重邮箱检测
apiRouter.post('/conflict/email', async (req, res, next) => {
  let body = req.body;
  let exp = /^[A-Za-z0-9]+([_\.][A-Za-z0-9]+)*@([A-Za-z0-9\-]+\.)+[A-Za-z]{2,6}$/;
  if(!exp.test(body.email)) {
    res.json({
      code: -1,
      msg: '请输入有效的邮箱地址'
    })
    return;
  }
  try {
    if(body.email) {
      let dbEmail = await db.get('SELECT * FROM users WHERE email = ?', body.email);
      if(dbEmail) {
        res.json({
          code: -1,
          msg: '此邮箱已被注册'
        })
      } else {
        res.json({
          code: 0,
          msg: '此邮箱可以注册'
        })
      }
    }
  } catch(e) {
    console.log(e)
  }
})

//用户注册
apiRouter.route("/register")
.post(uploader.single('avatar'), async (req, res, next) => {
  // console.log(req.body)
  let body = req.body;
  console.log('收到注册请求', body);
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
    let dateNow = (new Date()).toISOString();
    await db.run('insert into users values (?, ?, ?, ?, ?)', [body.name, body.password, body.email, avatarPath, dateNow]);
    res.json({
      code: 0,
      msg: '注册成功!'
    })
  } catch(e) {
    res.json({
      code: -1,
      msg: '注册失败' + e.toString()
    })
  }
})

//用户发帖
apiRouter.post('/create-post', async (req, res, next) => {
  let body = req.body;
  console.log('收到发帖请求', body);
  if(req.user) {
    let dateNow = (new Date()).toISOString();
    try {
      await db.run('INSERT INTO postInfo VALUES (?, ?, ?, ?, ?, ?)', [body.title, body.content, req.user.id, dateNow, dateNow, 1]);
      let postId = await db.get('SELECT rowid AS id FROM postInfo WHERE ownerId = ? ORDER BY id DESC', req.user.id);
      res.json({
        code: 0,
        msg: '发布成功!',
        postId: postId
      })
    } catch {
      res.json({
        code: -1,
        msg: '未知错误'
      })
    }
  } else {
    res.json({
      code: -1,
      msg: '未登录'
    })
  }
})

//用户评论
apiRouter.post('/comment', async (req, res, next) => {
  let body = req.body;
  if (req.user) {
    let dateNow = (new Date()).toISOString();
    await db.run('INSERT INTO comments VALUES (?, ?, ?, ?, ?)', [body.replyTo, req.user.id, body.content, dateNow, 1]);
    await db.run('UPDATE postInfo SET lastComment = ? WHERE rowid = ?', dateNow, body.replyTo);
    let user = await db.get('SELECT rowid AS id, name, avatar, email, createAt FROM users WHERE id = ?', req.user.id);
    let comment = await db.get('SELECT rowid AS id, * FROM comments ORDER BY rowid DESC');
    res.json({
      code: 0,
      msg: '回复成功!',
      comment: comment,
      user: user
    })
  } else {
    res.json({
      code: -1,
      msg: '未登陆'
    })
  }
})

//整帖删除
apiRouter.post('/delete-post/:id', async (req, res, next) => {
  if (req.user) {
    var comment = await db.get('SELECT * FROM postInfo WHERE rowid = ?', req.params.id)
    if(comment) {
      if (comment.ownerId == req.user.id) {
        await db.run('UPDATE postInfo SET active = 0 WHERE rowid = ?', req.params.id)
        await db.run('UPDATE comments SET active = 0 WHERE replyTo = ?', req.params.id);
        res.json({
          code: 0,
          msg: '删除成功'
        })
      } else {
        res.json({
          code: -1,
          msg: '权限不足，该评论并非此登陆用户所发'
        })
      }
    } else {
      res.json({
        code: -1,
        msg: '未找到目标帖子'
      })
    }
  } else {
    res.json({
      code: -1,
      msg: '用户未登陆'
    })
  }
})

//评论删除
apiRouter.post('/delete-comment/:id', async (req, res, next) => {
  if (req.user) {
    var comment = await db.get('SELECT * FROM comments WHERE rowid = ?', req.params.id)
    if(comment) {
      if (comment.ownerId == req.user.id) {
        await db.run('UPDATE comments SET active = 0 WHERE rowid = ?', req.params.id)
        res.json({
          code: 0,
          msg: '删除成功'
        })
      } else {
        res.json({
          code: -1,
          msg: '权限不足，该评论并非此登陆用户所发'
        })
      }
    } else {
      res.json({
        code: -1,
        msg: '未找到目标回复'
      })
    }
  } else {
    res.json({
      code: -1,
      msg: '用户未登陆'
    })
  }
})

//获取其他用户信息
apiRouter.get('/person/:id', async (req, res, next) => {
  let id = req.params.id;

  try {
    let checkUser = await db.get('SELECT rowid AS id, name, email, avatar, createAt FROM users WHERE id = ?', id);
    let checkPosts = await db.all('SELECT rowid AS id, title, createAt, lastComment FROM postInfo WHERE ownerId = ? AND active = 1 ORDER BY id DESC', id);
    let checkComments = await db.all('SELECT comments.rowid as id, comments.content, comments.createAt, postInfo.title, users.name, users.rowid as userId FROM comments, postInfo, users WHERE comments.ownerId = ? AND comments.replyTo = postInfo.rowid AND userId = postInfo.ownerId AND comments.active = 1 ORDER BY id DESC', id);
    let checkThisUser
    if(req.user) {
      checkThisUser = await db.get('SELECT rowid AS id FROM users WHERE id = ?', req.user.id);
    } else {
      checkThisUser = {}
    }
    res.json({
      code: 0,
      checkUser: checkUser,
      checkPosts: checkPosts,
      checkComments: checkComments,
      checkThisUser: checkThisUser
    })
  } catch(e) {
    console.log(e);
    res.json({
      code: -1,
      msg: '未知错误'
    })
  }
})
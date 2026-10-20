/* ============================================================
   文言文背诵 · 阅读页脚本
   数据来自 data/texts/<slug>.js：
       window.TEXT = { slug, title, author, paras, words, marks, WORDS, PARAS }
   逻辑与旧的单文件页面一致（逐段卡片 + 点句看译文 + 点加点字看释义）
   ============================================================ */

var TEXT = window.TEXT;
var WORDS = (TEXT && TEXT.WORDS) || {};
var PARAS = (TEXT && TEXT.PARAS) || [];
var transOpen = {};

/* 段落中文序号：支持任意段数 */
var CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cnNum(n) {
  if (n < 10) return CN_DIGIT[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + CN_DIGIT[n % 10];
  var t = CN_DIGIT[Math.floor(n / 10)] + '十';
  return n % 10 ? t + CN_DIGIT[n % 10] : t;
}

function $(s) {
  return document.querySelector(s);
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ================= 渲染 ================= */
function renderArticle() {
  var html = '';
  for (var p = 0; p < PARAS.length; p++) {
    var sents = PARAS[p].sents || [];
    var single = sents.length === 1;
    var phtml = '';
    for (var s = 0; s < sents.length; s++) {
      /* 一段只有一句时不再重复显示句号序号（段号已经等于它） */
      phtml += renderSent(p, s, sents[s], single ? null : s + 1, p + '-' + s);
    }
    html +=
      '<section class="para">' +
      '<div class="para-head">' +
      '<span class="para-no">第' + cnNum(p + 1) + '段</span>' +
      '<span class="para-gist">' + esc(PARAS[p].gist || '') + '</span></div>' +
      phtml +
      '</section>';
  }
  $('#article').innerHTML = html;
}

function renderSent(p, s, sent, num, key) {
  var segs = sent[0],
    trans = sent[1],
    hot = sent[2];
  var body = '';
  segs.forEach(function (seg) {
    if (seg.k) {
      body +=
        '<span class="word' + (seg.c ? ' c' + seg.c : '') + '" data-k="' + seg.k + '">' +
        esc(seg.w) +
        '</span>';
    } else {
      body += esc(seg);
    }
  });
  var hotCls = hot ? ' hot' : '';
  var transShow = transOpen[key] ? ' show' : '';
  var noHtml = num === null ? '' : '<div class="s-no">' + num + '</div>';
  return (
    '<div class="sent">' +
    noHtml +
    '<div class="s-main">' +
    '<div class="s-body' + hotCls + ' clickable" data-sent="' + key + '">' + body + '</div>' +
    '<div class="trans' + transShow + '"><b>译文</b>' + esc(trans) + '</div>' +
    '</div></div>'
  );
}

/* ================= 字词弹窗 ================= */
var pop, mask;

function openPop(k, el) {
  var o = WORDS[k];
  if (!o) return;
  pop.innerHTML =
    '<button class="p-close" type="button" data-close>×</button>' +
    '<span class="p-word">' + esc(o.w) + '</span>' +
    '<div class="p-mean">' + esc(o.mean) + '</div>';
  mask.classList.add('show');
  pop.classList.add('show');
  /* 手机也一样按被点字词定位：视口宽高取文档实际可用尺寸，弹窗始终夹在屏内 */
  var vw = document.documentElement.clientWidth || window.innerWidth;
  var vh = window.innerHeight || document.documentElement.clientHeight;
  var r = el.getBoundingClientRect();
  var pw = pop.offsetWidth,
    ph = pop.offsetHeight;
  var left = Math.min(Math.max(r.left + r.width / 2 - pw / 2, 10), vw - pw - 10);
  if (left < 10) left = 10;
  var top = r.bottom + 8;
  if (top + ph > vh - 10) top = r.top - ph - 8;
  if (top < 10) top = 10;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function closePop() {
  mask.classList.remove('show');
  pop.classList.remove('show');
}

/* ================= 启动 ================= */
function boot() {
  pop = $('#pop');
  mask = $('#mask');

  if (!TEXT) {
    $('#article').innerHTML =
      '<p class="noscript">没有读到这篇的数据文件（data/texts/…js）。' +
      '请从首页进入，或检查文件是否上传完整。</p>';
    return;
  }

  document.title = TEXT.title + ' · 文言文背诵';
  var h1 = $('.title-row h1');
  if (h1) h1.textContent = TEXT.title;
  var au = $('.title-row .author');
  if (au) au.textContent = TEXT.author;

  mask.addEventListener('click', closePop);
  pop.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closePop();
  });

  $('#article').addEventListener('click', function (e) {
    var t = e.target;
    var word = t.closest('.word');
    if (word) {
      e.stopPropagation();
      openPop(word.getAttribute('data-k'), word);
      return;
    }
    var body = t.closest('[data-sent]');
    if (body) {
      var key = body.getAttribute('data-sent');
      transOpen[key] = !transOpen[key];
      var tr = body.nextElementSibling;
      if (tr) tr.classList.toggle('show', !!transOpen[key]);
    }
  });

  renderArticle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

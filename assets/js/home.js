/* ============================================================
   文言文背诵 · 首页脚本
   数据来自 data/catalog.js：window.CATALOG = [{no, slug, title, author, ...}]
   ============================================================ */

(function () {
  "use strict";

  /* 目标篇数：目录里不足这么多时，底部提示还差几篇 */
  var TARGET = 25;

  var items = (window.CATALOG || []).slice().sort(function (a, b) {
    return (a.no || 0) - (b.no || 0);
  });

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pad(n) {
    n = String(n);
    return n.length < 2 ? "0" + n : n;
  }

  function metaLine(it) {
    return esc(it.author || "");
  }

  function render() {
    var html = items
      .map(function (it) {
        var href = "texts/" + it.slug + ".html";
        return (
          '<li data-key="' +
          esc((it.title || "") + " " + (it.author || "")) +
          '"><a class="item" href="' +
          esc(href) +
          '">' +
          '<span class="no">' + pad(it.no || 0) + "</span>" +
          '<span class="body">' +
          '<span class="title">' + esc(it.title) + "</span>" +
          '<span class="meta">' + metaLine(it) + "</span>" +
          "</span>" +
          '<span class="go">›</span>' +
          "</a></li>"
        );
      })
      .join("");

    document.getElementById("list").innerHTML = html;
    document.getElementById("ready").textContent = items.length;
    document.getElementById("total").textContent = TARGET;

    var lack = TARGET - items.length;
    var pending = document.getElementById("pending");
    if (pending && lack > 0) {
      pending.hidden = false;
      pending.innerHTML = "还有 <b>" + lack + "</b> 篇待补充";
    }
  }

  /* ---------------- 搜索 ---------------- */
  function bindSearch() {
    var q = document.getElementById("q");
    var empty = document.getElementById("empty");
    if (!q) return;
    q.addEventListener("input", function () {
      var kw = q.value.trim().toLowerCase();
      var lis = document.querySelectorAll("#list li");
      var shown = 0;
      for (var i = 0; i < lis.length; i++) {
        var hit = !kw || (lis[i].getAttribute("data-key") || "").toLowerCase().indexOf(kw) >= 0;
        lis[i].hidden = !hit;
        if (hit) shown++;
      }
      if (empty) empty.hidden = shown > 0;
    });
  }

  function start() {
    render();
    bindSearch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

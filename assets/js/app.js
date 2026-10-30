/* ============================================================
   山东专升本 · 文学常识
   纯前端答题逻辑：随机抽题、选择/填空判分、即时解析、结果回看
   ============================================================ */
(function () {
  "use strict";

  const CHOICE_LETTERS = "ABCDEF";
  const app = document.getElementById("app");
  const rawConfig = window.QUIZ_CONFIG || {};
  const rawBank = Array.isArray(window.QUESTION_BANK) ? window.QUESTION_BANK : [];

  const bankIssues = [];
  const seenIds = new Set();
  const CONFIG = normalizeConfig(rawConfig);
  const BANK = rawBank
    .map(function (item, index) {
      return normalizeQuestion(item, index, bankIssues, seenIds);
    })
    .filter(Boolean);

  const state = {
    round: [],
    index: 0,
    answers: [],
    selected: null,
    multiSelected: [],
    fillValues: [],
    submitted: false,
    startedAt: 0,
    finishedAt: 0,
    timerId: null,
    selectedCategories: new Set()
  };

  if (bankIssues.length) {
    console.warn(
      "【题库格式提示】请检查以下内容：\n" +
        bankIssues.map(function (item) { return "· " + item; }).join("\n")
    );
  } else {
    console.info("【题库】已载入 " + BANK.length + " 道题，格式正常。");
  }

  /* ----------------------------- 数据 ----------------------------- */

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function toInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : fallback;
  }

  function normalizeConfig(config) {
    return {
      total: clamp(toInteger(config.total, 10), 1, 50)
    };
  }

  function cleanText(value) {
    return value == null ? "" : String(value).trim();
  }

  function normalizeQuestion(raw, index, issues, ids) {
    if (!raw || typeof raw !== "object") {
      issues.push("第 " + (index + 1) + " 条不是有效的题目对象");
      return null;
    }

    const label = raw.id ? "题目 " + raw.id : "第 " + (index + 1) + " 题";
    const type = cleanText(raw.type).toLowerCase();
    const question = cleanText(raw.question);
    const category = cleanText(raw.category) || "未分类";
    const level = clamp(toInteger(raw.level, 2), 1, 3);
    const explanation = cleanText(raw.explanation);
    const id = cleanText(raw.id) || "q-" + (index + 1);

    if (type !== "choice" && type !== "fill" && type !== "multi") {
      issues.push(label + "：type 只能是 choice、multi 或 fill");
      return null;
    }
    if (!question) {
      issues.push(label + "：缺少 question 题干");
      return null;
    }
    if (ids.has(id)) {
      issues.push(label + "：id「" + id + "」重复，建议换成唯一编号");
    } else {
      ids.add(id);
    }

    if (type === "choice" || type === "multi") {
      const options = Array.isArray(raw.options)
        ? raw.options.map(cleanText)
        : [];

      if (options.length < 2 || options.length > CHOICE_LETTERS.length) {
        issues.push(label + "：options 需要 2—6 个选项");
        return null;
      }
      if (options.some(function (option) { return !option; })) {
        issues.push(label + "：options 中有空选项");
        return null;
      }

      if (type === "multi") {
        const rawAnswers = Array.isArray(raw.answers)
          ? raw.answers
          : Array.isArray(raw.answer)
            ? raw.answer
            : [raw.answer];
        const answerIndexes = rawAnswers
          .map(function (value) {
            if (typeof value === "number" && Number.isInteger(value)) return value;
            return CHOICE_LETTERS.indexOf(cleanText(value).toUpperCase());
          })
          .filter(function (value, index, list) {
            return value >= 0 && value < options.length && list.indexOf(value) === index;
          })
          .sort(function (a, b) { return a - b; });

        if (answerIndexes.length < 2) {
          issues.push(label + "：多选题 answers 至少要有两个正确选项");
          return null;
        }

        return {
          id: id,
          type: type,
          category: category,
          level: level,
          question: question,
          options: options,
          answerIndexes: answerIndexes,
          explanation: explanation
        };
      }

      let answerIndex = -1;
      if (typeof raw.answer === "number" && Number.isInteger(raw.answer)) {
        answerIndex = raw.answer;
      } else {
        answerIndex = CHOICE_LETTERS.indexOf(cleanText(raw.answer).toUpperCase());
      }

      if (answerIndex < 0 || answerIndex >= options.length) {
        issues.push(label + "：answer 应填写正确选项的字母，如 \"A\"");
        return null;
      }

      return {
        id: id,
        type: type,
        category: category,
        level: level,
        question: question,
        options: options,
        answerIndex: answerIndex,
        explanation: explanation
      };
    }

    if (!Array.isArray(raw.blanks) || raw.blanks.length === 0) {
      issues.push(label + "：填空题缺少 blanks 数组");
      return null;
    }

    const blanks = raw.blanks.map(function (group) {
      const values = Array.isArray(group) ? group : [group];
      return values.map(cleanText).filter(Boolean);
    });

    if (blanks.some(function (group) { return group.length === 0; })) {
      issues.push(label + "：blanks 中有空答案");
      return null;
    }

    const holeCount = (question.match(/____/g) || []).length;
    if (holeCount !== blanks.length) {
      issues.push(
        label +
          "：题干里有 " +
          holeCount +
          " 个「____」，但 blanks 写了 " +
          blanks.length +
          " 个空，数量需要一致"
      );
      return null;
    }

    return {
      id: id,
      type: type,
      category: category,
      level: level,
      question: question,
      blanks: blanks,
      explanation: explanation
    };
  }

  function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temporary = copy[i];
      copy[i] = copy[j];
      copy[j] = temporary;
    }
    return copy;
  }

  function drawRound() {
    if (!BANK.length) return [];
    const pool = BANK.filter(function (item) {
      return state.selectedCategories.has(item.category);
    });
    return shuffle(pool).slice(0, Math.min(CONFIG.total, pool.length));
  }

  function getCategories() {
    const counts = new Map();
    BANK.forEach(function (item) {
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
    });
    return Array.from(counts, function (entry) {
      return { name: entry[0], count: entry[1] };
    });
  }

  function getFilterState() {
    const categories = getCategories();
    const validNames = new Set(categories.map(function (item) { return item.name; }));
    state.selectedCategories.forEach(function (name) {
      if (!validNames.has(name)) state.selectedCategories.delete(name);
    });

    const selected = categories.filter(function (item) {
      return state.selectedCategories.has(item.name);
    });
    const filteredBank = BANK.filter(function (item) {
      return state.selectedCategories.has(item.category);
    });

    return {
      categories: categories,
      selected: selected,
      selectedCount: selected.length,
      filteredBank: filteredBank,
      roundSize: Math.min(CONFIG.total, filteredBank.length)
    };
  }

  function currentQuestion() {
    return state.round[state.index] || null;
  }

  function currentRecord() {
    return state.answers[state.index] || null;
  }

  /* ----------------------------- 工具 ----------------------------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return pad2(Math.floor(seconds / 60)) + ":" + pad2(seconds % 60);
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (!minutes) return rest + " 秒";
    return minutes + " 分 " + rest + " 秒";
  }

  function scrollTop() {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    state.timerId = setInterval(function () {
      const timer = $("#timer");
      if (!timer) return;
      timer.textContent = formatClock(Date.now() - state.startedAt);
    }, 500);
  }

  function setTitle(text) {
    document.title = text;
  }

  function normalizeAnswer(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC")
      .trim()
      .replace(/[\s\u3000]+/g, "")
      .replace(/[《》〈〉“”‘’"'`]/g, "")
      .replace(/[，。、；：,.!?！？·—–\-]/g, "")
      .toLowerCase();
  }

  function answerMatches(input, accepted) {
    const normalizedInput = normalizeAnswer(input);
    if (!normalizedInput) return false;
    return accepted.some(function (answer) {
      return normalizeAnswer(answer) === normalizedInput;
    });
  }

  function choiceText(question, index) {
    if (index == null || index < 0 || !question.options[index]) return "未作答";
    return CHOICE_LETTERS[index] + ". " + question.options[index];
  }

  function reviewOptionsHTML(question, record) {
    if (question.type === "fill") return "";
    const correctIndexes = question.type === "multi"
      ? question.answerIndexes
      : [question.answerIndex];
    const selectedIndexes = !record
      ? []
      : question.type === "multi"
        ? record.selected
        : [record.selected];

    return (
      '<div class="review-options" aria-label="全部选项">' +
      question.options.map(function (option, index) {
        const isCorrect = correctIndexes.indexOf(index) >= 0;
        const isSelected = selectedIndexes.indexOf(index) >= 0;
        const classes = ["review-option"];
        if (isCorrect) classes.push("is-correct");
        else if (isSelected) classes.push("is-wrong");
        else classes.push("is-dim");
        return (
          '<div class="' + classes.join(" ") + '">' +
          '<span class="review-option-letter">' + CHOICE_LETTERS[index] + "</span>" +
          '<span class="review-option-text">' + escapeHTML(option) + "</span>" +
          '<span class="review-option-mark" aria-hidden="true">' +
          (isCorrect ? "✓" : isSelected ? "✕" : "") +
          "</span>" +
          "</div>"
        );
      }).join("") +
      "</div>"
    );
  }

  function formatBlankText(question, values) {
    const list = values || [];
    return question.blanks
      .map(function (group, index) {
        const value = cleanText(list[index]);
        const prefix = question.blanks.length > 1 ? index + 1 + ". " : "";
        return prefix + (value || "未填写");
      })
      .join("　");
  }

  function formatCorrectBlanks(question) {
    return question.blanks
      .map(function (group, index) {
        const prefix = question.blanks.length > 1 ? index + 1 + ". " : "";
        return prefix + group[0];
      })
      .join("　");
  }

  function truncate(text, length) {
    const characters = Array.from(text);
    return characters.length > length
      ? characters.slice(0, length).join("") + "…"
      : text;
  }

  function roundTitle(correct, total) {
    const percentage = total ? correct / total : 0;
    if (percentage === 1) return "全对，这一组很干净。";
    if (percentage >= 0.8) return "很稳，只差临门一脚。";
    if (percentage >= 0.6) return "基础在线，错题再看一遍。";
    return "先别急，回看比刷新更重要。";
  }

  /* ----------------------------- 首页 ----------------------------- */

  function renderHome() {
    stopTimer();
    setTitle("文学常识 · 十题测 | 山东专升本");
    const filterState = getFilterState();
    const categories = filterState.categories;
    const roundSize = filterState.roundSize;
    const hasBank = BANK.length > 0;
    const hasCategories = filterState.selectedCount > 0;
    const hasSelection = hasCategories;
    const canStart = hasBank && hasSelection;
    const displayRound = roundSize || CONFIG.total;
    const titleLead = displayRound === 10 ? "十题一局" : displayRound + " 题一局";

    const categoryChips = categories
      .map(function (item) {
        const checked = state.selectedCategories.has(item.name);
        return (
          '<label class="chip chip--filter' +
          (checked ? " is-checked" : "") +
          '"><input type="checkbox" class="category-checkbox" value="' +
          escapeHTML(item.name) +
          '"' +
          (checked ? " checked" : "") +
          "><span>" +
          escapeHTML(item.name) +
          "</span><i>" +
          item.count +
          "</i></label>"
        );
      })
      .join("");

    const selectionSummary =
      "板块 " +
      filterState.selectedCount +
      "/" +
      categories.length +
      " · " +
      filterState.filteredBank.length +
      " 题";

    const randomNote = hasSelection
      ? "从 <b>" +
        filterState.filteredBank.length +
        "</b> 道题中随机抽取，<b>题型不设固定比例</b>。"
      : "先勾选至少一个板块，再从选中的题里随机抽取。";

    const filterNote = !hasBank
      ? ""
      : !hasCategories
        ? "至少勾选一个板块，才能开始。"
        : filterState.filteredBank.length < CONFIG.total
          ? "当前筛选只有 " +
            filterState.filteredBank.length +
            " 题，本轮会抽取全部 " +
            filterState.filteredBank.length +
            " 题。"
          : "";

    const quickFacts =
      '<span><b>' +
      roundSize +
      "</b> 题 / 轮</span>" +
      '<span class="dot" aria-hidden="true"></span>' +
      "<span><b>" +
      filterState.selectedCount +
      "</b> 个板块</span>" +
      '<span class="dot" aria-hidden="true"></span>' +
      "<span>同轮不重复</span>";

    const startLabel = !hasBank
      ? "题库还没有题目"
      : !hasCategories
        ? "请先勾选板块"
        : "开始随机抽题";
    const startTail = !hasBank
      ? "请先编辑 questions.js"
      : !hasCategories
        ? "至少选一个板块"
        : roundSize + " 题 <i>→</i>";

    const issueNote = bankIssues.length
      ? '<p class="bank-note bank-note--warn">题库自检：有 ' +
        bankIssues.length +
        " 处格式提示，部分题目可能已跳过。可在浏览器控制台查看详情。</p>"
      : "";

    const coverageHTML = categories.length
      ? '<section class="coverage" aria-label="题库覆盖范围">' +
        '<div class="coverage-head"><span>题库覆盖</span><span id="selection-summary">' +
        selectionSummary +
        "</span></div>" +
        '<div class="chips">' +
        categoryChips +
        "</div>" +
        '<div class="coverage-footer"><span>可多选，只从勾选板块抽题</span>' +
        '<span class="coverage-actions">' +
        '<button type="button" data-action="select-all-categories">全选</button>' +
        '<button type="button" data-action="select-none-categories">清空</button>' +
        "</span></div>" +
        "</section>"
      : "";

    app.innerHTML =
      '<main class="screen screen--home">' +
      '<span class="hero-mark" aria-hidden="true">文</span>' +
      '<header class="site-head">' +
      '<div class="brand">' +
      '<span class="seal" aria-hidden="true">文</span>' +
      '<span class="brand-copy"><strong>文学常识</strong><small>山东专升本 · 语文</small></span>' +
      "</div>" +
      '<span class="edition">备考版</span>' +
      "</header>" +

      '<section class="hero" aria-labelledby="home-title">' +
      '<p class="eyebrow"><span aria-hidden="true"></span>SHANDONG · 文学常识</p>' +
      '<h1 id="home-title"><span id="round-title-lead">' +
      escapeHTML(titleLead) +
      '</span>，<br><em>把文常</em>过一遍。</h1>' +
      '<p class="hero-lead">先勾选要练的板块，再从选中的题里随机抽题。选择题和填空题都可能出现，答完立刻核对。</p>' +
      "</section>" +

      coverageHTML +

      '<section class="start-card" aria-label="开始答题">' +
      '<div class="start-card__head">' +
      '<div><p class="micro-label">本轮题量</p>' +
      '<p class="mix-copy"><strong id="round-size">' +
      roundSize +
      '</strong> 道题<span class="mix-tag">选择 / 填空随机</span></p></div>' +
      '<div class="bank-total"><strong>' +
      BANK.length +
      "</strong><span>题题库</span></div>" +
      "</div>" +

      '<p class="random-note" id="random-note">' +
      randomNote +
      "</p>" +

      '<div class="quick-facts" id="quick-facts">' +
      quickFacts +
      "</div>" +

      '<button class="primary-button primary-button--start" type="button" data-action="start" id="start-button"' +
      (canStart ? "" : " disabled") +
      '><span id="start-label">' +
      startLabel +
      '</span><span class="button-tail" id="start-tail" aria-hidden="true">' +
      startTail +
      "</span></button>" +

      '<p class="start-note">只从勾选板块抽题 · 同一轮题目不重复 · 提交后立即看解析</p>' +
      '<p class="bank-note" id="filter-note"' +
      (filterNote ? "" : " hidden") +
      ">" +
      filterNote +
      "</p>" +
      issueNote +
      "</section>" +

      '<footer class="site-footer">' +
      "<span>文以载道，温故知新</span>" +
      '<span class="footer-mark" aria-hidden="true">鲁</span>' +
      "</footer>" +
      "</main>";
  }

  function updateHomeSelectionUI() {
    if (!$(".screen--home")) return;
    const filterState = getFilterState();
    const hasBank = BANK.length > 0;
    const hasCategories = filterState.selectedCount > 0;
    const hasSelection = hasCategories;

    const summary = $("#selection-summary");
    if (summary) {
      summary.textContent =
        "板块 " +
        filterState.selectedCount +
        "/" +
        filterState.categories.length +
        " · " +
        filterState.filteredBank.length +
        " 题";
    }

    const roundSize = $("#round-size");
    if (roundSize) roundSize.textContent = String(filterState.roundSize);

    const randomNote = $("#random-note");
    if (randomNote) {
      randomNote.innerHTML = hasSelection
        ? "从 <b>" +
          filterState.filteredBank.length +
          "</b> 道题中随机抽取，<b>题型不设固定比例</b>。"
        : "先勾选至少一个板块，再从选中的题里随机抽取。";
    }

    const facts = $("#quick-facts");
    if (facts) {
      facts.innerHTML =
        "<span><b>" +
        filterState.roundSize +
        "</b> 题 / 轮</span>" +
        '<span class="dot" aria-hidden="true"></span>' +
        "<span><b>" +
        filterState.selectedCount +
        "</b> 个板块</span>" +
        '<span class="dot" aria-hidden="true"></span>' +
        "<span>同轮不重复</span>";
    }

    const startButton = $("#start-button");
    if (startButton) startButton.disabled = !(hasBank && hasSelection);

    const startLabel = $("#start-label");
    if (startLabel) {
      startLabel.textContent = !hasBank
        ? "题库还没有题目"
        : !hasCategories
          ? "请先勾选板块"
          : "开始随机抽题";
    }

    const startTail = $("#start-tail");
    if (startTail) {
      startTail.innerHTML = !hasBank
        ? "请先编辑 questions.js"
        : !hasCategories
          ? "至少选一个板块"
          : filterState.roundSize + " 题 <i>→</i>";
    }

    const filterNote = $("#filter-note");
    if (filterNote) {
      const note = !hasBank
        ? ""
        : !hasCategories
          ? "至少勾选一个板块，才能开始。"
          : filterState.filteredBank.length < CONFIG.total
            ? "当前筛选只有 " +
              filterState.filteredBank.length +
              " 题，本轮会抽取全部 " +
              filterState.filteredBank.length +
              " 题。"
            : "";
      filterNote.hidden = !note;
      filterNote.textContent = note;
    }

    const lead = $("#round-title-lead");
    if (lead) {
      const displayRound = filterState.roundSize || CONFIG.total;
      lead.textContent =
        displayRound === 10 ? "十题一局" : displayRound + " 题一局";
    }
  }

  function setAllCategories(checked) {
    const categories = getCategories();
    state.selectedCategories = new Set(
      checked ? categories.map(function (item) { return item.name; }) : []
    );
    $$(".category-checkbox").forEach(function (input) {
      input.checked = checked;
      const chip = input.closest(".chip");
      if (chip) chip.classList.toggle("is-checked", checked);
    });
    updateHomeSelectionUI();
  }

  /* ----------------------------- 答题 ----------------------------- */

  function renderQuiz(options) {
    const settings = options || {};
    const question = currentQuestion();
    if (!question) {
      renderHome();
      return;
    }

    const record = currentRecord();
    const submitted = Boolean(record);
    state.submitted = submitted;
    const progress = ((state.index + 1) / state.round.length) * 100;
    const isLast = state.index === state.round.length - 1;
    const actionLabel = submitted ? (isLast ? "查看成绩" : "下一题") : "确认答案";
    const action = submitted ? "next" : "confirm";
    const disabled = !submitted && (
      (question.type === "choice" && state.selected == null) ||
      (question.type === "multi" && state.multiSelected.length === 0)
    );
    const useBlankSheet = question.type === "fill" && question.blanks.length >= 3;

    setTitle(
      pad2(state.index + 1) +
        " / " +
        state.round.length +
        " · 文学常识"
    );

    app.innerHTML =
      '<main class="screen screen--quiz">' +
      '<header class="quiz-head">' +
      '<button class="icon-button" type="button" data-action="quit" aria-label="退出本轮">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' +
      "</button>" +
      '<div class="quiz-position"><span>第 ' +
      (state.index + 1) +
      " 题</span><b>共 " +
      state.round.length +
      " 题</b></div>" +
      '<div class="quiz-timer" id="timer" aria-label="本轮用时">' +
      formatClock(Date.now() - state.startedAt) +
      "</div>" +
      "</header>" +

      '<div class="progress-track" role="progressbar" aria-label="答题进度" aria-valuemin="1" aria-valuemax="' +
      state.round.length +
      '" aria-valuenow="' +
      (state.index + 1) +
      '"><span style="width:' +
      progress +
      '%"></span></div>' +

      '<article class="question-card' +
      (submitted ? " is-submitted" : "") +
      '">' +
      '<div class="question-meta">' +
      '<span class="chip chip--category">' +
      escapeHTML(question.category) +
      "</span>" +
      '<span class="type-badge type-badge--' +
      question.type +
      '">' +
      (question.type === "choice" ? "单项选择" : question.type === "multi" ? "多项选择" : "填空") +
      "</span>" +
      "</div>" +
      '<h2 class="question-stem" id="question-title" tabindex="-1"></h2>' +
      '<p class="answer-hint">' +
      (question.type === "choice"
        ? "选出唯一正确的一项"
        : question.type === "multi"
          ? "可多选，全部选对才算正确"
          : useBlankSheet
            ? "按序号在下方填写答案"
            : "在横线处填写答案") +
      "</p>" +
      '<div class="answer-area" id="answer-area"></div>' +
      '<div id="feedback-slot"></div>' +
      "</article>" +

      '<div class="quiz-footer">' +
      '<button class="primary-button" type="button" data-action="' +
      action +
      '" id="main-action"' +
      (disabled ? " disabled" : "") +
      "><span>" +
      actionLabel +
      '</span><span class="button-tail" aria-hidden="true">' +
      (submitted ? (isLast ? "✓" : "→") : "✓") +
      "</span></button>" +
      "</div>" +

      '<dialog class="quit-dialog" id="quit-dialog">' +
      '<div class="dialog-inner">' +
      '<span class="dialog-seal" aria-hidden="true">止</span>' +
      "<h2>先停在这里？</h2>" +
      "<p>本轮的答题记录和当前得分不会保存。</p>" +
      '<div class="dialog-actions">' +
      '<button class="ghost-button" type="button" data-action="close-dialog">继续答题</button>' +
      '<button class="danger-button" type="button" data-action="quit-confirm">退出本轮</button>' +
      "</div>" +
      "</div>" +
      "</dialog>" +
      "</main>";

    renderStem(question, record, useBlankSheet);
    mountAnswerArea(question, record, useBlankSheet);

    if (record) {
      const slot = $("#feedback-slot");
      if (slot) slot.innerHTML = feedbackHTML(question, record);
    }

    if (settings.scroll !== false) scrollTop();

    if (settings.focusFeedback) {
      window.setTimeout(function () {
        const feedback = $("#feedback");
        if (feedback) {
          feedback.focus({ preventScroll: true });
          feedback.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 50);
    } else if (settings.focusHeading) {
      const heading = $("#question-title");
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  function renderStem(question, record, useBlankSheet) {
    const stem = $("#question-title");
    if (!stem) return;
    stem.replaceChildren();

    if (question.type === "choice" || question.type === "multi") {
      stem.textContent = question.question;
      return;
    }

    const parts = question.question.split("____");
    parts.forEach(function (part, index) {
      if (part) stem.append(document.createTextNode(part));
      if (index < question.blanks.length) {
        if (useBlankSheet) {
          const marker = document.createElement("span");
          marker.className = "blank-marker";
          marker.textContent = String(index + 1);
          marker.setAttribute("aria-label", "第 " + (index + 1) + " 空");
          stem.append(marker);
        } else {
          stem.append(createBlankInput(question, index, record));
        }
      }
    });
  }

  function createBlankInput(question, index, record, sheet) {
    const input = document.createElement("input");
    const accepted = question.blanks[index] || [];
    const longest = accepted.reduce(function (length, answer) {
      return Math.max(length, Array.from(answer).length);
    }, 2);
    const blankRecord = record && record.blankResults ? record.blankResults[index] : null;

    input.type = "text";
    input.className = sheet ? "blank-input blank-input--sheet" : "blank-input";
    input.dataset.blankIndex = String(index);
    input.id = "blank-" + index;
    input.value = state.fillValues[index] || "";
    input.setAttribute("aria-label", "第 " + (index + 1) + " 空");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("enterkeyhint", "done");
    if (!sheet) {
      input.style.setProperty("--blank-chars", String(Math.min(Math.max(longest, 2), 9)));
    }

    if (record) {
      input.disabled = true;
      if (blankRecord) {
        input.classList.add(blankRecord.correct ? "is-correct" : "is-wrong");
        input.setAttribute("aria-invalid", blankRecord.correct ? "false" : "true");
      }
    }

    return input;
  }

  function mountAnswerArea(question, record, useBlankSheet) {
    const area = $("#answer-area");
    if (!area) return;
    area.replaceChildren();

    if (question.type === "choice" || question.type === "multi") {
      mountChoices(area, question, record, question.type === "multi");
      return;
    }

    if (useBlankSheet) {
      const sheet = document.createElement("div");
      sheet.className = "blank-sheet";
      question.blanks.forEach(function (_, index) {
        const row = document.createElement("label");
        row.className = "blank-row";

        const number = document.createElement("span");
        number.className = "blank-number";
        number.setAttribute("aria-hidden", "true");
        number.textContent = String(index + 1);

        row.append(number, createBlankInput(question, index, record, true));
        sheet.append(row);
      });
      area.append(sheet);
    }

    const hint = document.createElement("p");
    hint.className = "fill-tip";
    hint.textContent = useBlankSheet
      ? "共 " + question.blanks.length + " 个空，按序号填写，全部答对才算本题正确。"
      : question.blanks.length > 1
        ? "共 " + question.blanks.length + " 个空，全部答对才算本题正确。"
        : "答案会自动忽略空格、标点和书名号。";
    area.append(hint);
  }

  function mountChoices(area, question, record, isMulti) {
    const list = document.createElement("div");
    list.className = "options" + (isMulti ? " options--multi" : "");
    list.setAttribute("role", isMulti ? "group" : "radiogroup");
    list.setAttribute("aria-labelledby", "question-title");

    const correctIndexes = isMulti ? question.answerIndexes : [question.answerIndex];
    const selectedIndexes = isMulti
      ? (record ? record.selected : state.multiSelected)
      : [record ? record.selected : state.selected];

    question.options.forEach(function (option, index) {
      const label = document.createElement("label");
      label.className = "option";

      const input = document.createElement("input");
      input.type = isMulti ? "checkbox" : "radio";
      input.name = isMulti ? "multi" : "choice";
      input.value = String(index);
      input.checked = selectedIndexes.indexOf(index) >= 0;
      input.disabled = Boolean(record);

      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.setAttribute("aria-hidden", "true");
      letter.textContent = CHOICE_LETTERS[index];

      const text = document.createElement("span");
      text.className = "option-text";
      text.textContent = option;

      const mark = document.createElement("span");
      mark.className = "option-mark";
      mark.setAttribute("aria-hidden", "true");

      if (record) {
        if (correctIndexes.indexOf(index) >= 0) {
          label.classList.add("is-correct");
          mark.textContent = "✓";
        } else if (selectedIndexes.indexOf(index) >= 0) {
          label.classList.add("is-wrong");
          mark.textContent = "✕";
        } else {
          label.classList.add("is-dim");
        }
      } else if (selectedIndexes.indexOf(index) >= 0) {
        label.classList.add("is-selected");
      }

      label.append(input, letter, text, mark);
      list.append(label);
    });

    area.append(list);
  }

  function feedbackHTML(question, record) {
    const correct = record.correct;
    const correctAnswer =
      question.type === "choice"
        ? choiceText(question, question.answerIndex)
        : question.type === "multi"
          ? question.answerIndexes.map(function (index) { return choiceText(question, index); }).join("；")
          : formatCorrectBlanks(question);
    const userAnswer =
      question.type === "choice"
        ? choiceText(question, record.selected)
        : question.type === "multi"
          ? record.selected.map(function (index) { return choiceText(question, index); }).join("；")
          : formatBlankText(question, record.fillValues);

    return (
      '<div class="feedback feedback--' +
      (correct ? "correct" : "wrong") +
      '" id="feedback" tabindex="-1" role="status">' +
      '<div class="feedback-head">' +
      '<span class="feedback-icon" aria-hidden="true">' +
      (correct ? "✓" : "✕") +
      "</span>" +
      "<div><strong>" +
      (correct ? "答对了" : "再记一遍") +
      "</strong><p>" +
      (correct ? "这个知识点已经收入囊中。" : "看清正确答案，下一题继续。") +
      "</p></div>" +
      "</div>" +
      '<dl class="answer-compare">' +
      (correct
        ? ""
        : "<div><dt>你的答案</dt><dd>" + escapeHTML(userAnswer) + "</dd></div>") +
      '<div><dt>正确答案</dt><dd class="correct-answer">' +
      escapeHTML(correctAnswer) +
      "</dd></div>" +
      "</dl>" +
      (question.explanation
        ? '<div class="explanation"><span>解析</span><p>' +
          escapeHTML(question.explanation) +
          "</p></div>"
        : "") +
      "</div>"
    );
  }

  function evaluateCurrent() {
    const question = currentQuestion();
    if (!question) return null;

    if (question.type === "choice") {
      return {
        type: "choice",
        selected: state.selected,
        correct: state.selected === question.answerIndex
      };
    }

    if (question.type === "multi") {
      const selected = state.multiSelected.slice().sort(function (a, b) { return a - b; });
      const expected = question.answerIndexes.slice().sort(function (a, b) { return a - b; });
      return {
        type: "multi",
        selected: selected,
        correct: selected.length === expected.length && selected.every(function (value, index) {
          return value === expected[index];
        })
      };
    }

    const blankResults = question.blanks.map(function (accepted, index) {
      const value = cleanText(state.fillValues[index]);
      return {
        value: value,
        correct: answerMatches(value, accepted)
      };
    });

    return {
      type: "fill",
      fillValues: state.fillValues.slice(),
      blankResults: blankResults,
      correct: blankResults.every(function (item) { return item.correct; })
    };
  }

  function submitCurrent() {
    if (state.submitted) return;
    const question = currentQuestion();
    if (!question) return;
    if (question.type === "choice" && state.selected == null) return;
    if (question.type === "multi" && state.multiSelected.length === 0) return;

    const record = evaluateCurrent();
    if (!record) return;

    state.answers[state.index] = record;
    state.submitted = true;
    renderQuiz({ scroll: false, focusFeedback: true });
  }

  function goToNext() {
    if (state.index >= state.round.length - 1) {
      state.finishedAt = Date.now();
      stopTimer();
      renderResult();
      return;
    }

    state.index += 1;
    state.selected = null;
    state.multiSelected = [];
    state.fillValues = [];
    state.submitted = false;
    renderQuiz({ scroll: true, focusHeading: true });
  }

  function startRound() {
    const round = drawRound();
    if (!round.length) {
      renderHome();
      return;
    }

    state.round = round;
    state.index = 0;
    state.answers = new Array(round.length).fill(null);
    state.selected = null;
    state.multiSelected = [];
    state.fillValues = [];
    state.submitted = false;
    state.startedAt = Date.now();
    state.finishedAt = 0;
    renderQuiz({ scroll: true });
    startTimer();
  }

  function goHome() {
    stopTimer();
    state.round = [];
    state.index = 0;
    state.answers = [];
    state.selected = null;
    state.multiSelected = [];
    state.fillValues = [];
    state.submitted = false;
    renderHome();
    scrollTop();
  }

  /* ----------------------------- 结果 ----------------------------- */

  function renderResult() {
    stopTimer();
    setTitle("本轮成绩 · 文学常识");

    const total = state.round.length;
    const records = state.answers;
    const correct = records.filter(function (record) {
      return record && record.correct;
    }).length;
    const wrong = total - correct;
    const percentage = total ? Math.round((correct / total) * 100) : 0;
    const elapsed = Math.max(0, state.finishedAt - state.startedAt);

    const choiceQuestions = state.round.filter(function (item) { return item.type !== "fill"; });
    const fillQuestions = state.round.filter(function (item) { return item.type === "fill"; });
    const choiceCorrect = state.round.reduce(function (totalCorrect, item, index) {
      const record = records[index];
      return totalCorrect + (item.type !== "fill" && record && record.correct ? 1 : 0);
    }, 0);
    const fillCorrect = state.round.reduce(function (totalCorrect, item, index) {
      const record = records[index];
      return totalCorrect + (item.type === "fill" && record && record.correct ? 1 : 0);
    }, 0);

    const reviewHTML = state.round
      .map(function (question, index) {
        const record = records[index];
        const isCorrect = Boolean(record && record.correct);
        const typeName = question.type === "choice" ? "单项选择" : question.type === "multi" ? "多项选择" : "填空";
        const userAnswer =
          !record
            ? "未作答"
            : question.type === "choice"
              ? choiceText(question, record.selected)
              : question.type === "multi"
                ? record.selected.map(function (item) { return choiceText(question, item); }).join("；")
                : formatBlankText(question, record.fillValues);
        const correctAnswer =
          question.type === "choice"
            ? choiceText(question, question.answerIndex)
            : question.type === "multi"
              ? question.answerIndexes.map(function (item) { return choiceText(question, item); }).join("；")
              : formatCorrectBlanks(question);

        return (
          '<details class="review-item' +
          (isCorrect ? " is-correct" : " is-wrong") +
          '"' +
          (isCorrect ? "" : " open") +
          ">" +
          "<summary>" +
          '<span class="review-mark" aria-hidden="true">' +
          (isCorrect ? "✓" : "✕") +
          "</span>" +
          '<span class="review-summary"><strong>' +
          (index + 1) +
          ". " +
          escapeHTML(truncate(question.question, 34)) +
          "</strong><small>" +
          escapeHTML(question.category) +
          " · " +
          typeName +
          "</small></span>" +
          '<span class="review-arrow" aria-hidden="true"></span>' +
          "</summary>" +
          '<div class="review-body">' +
          '<p class="review-stem">' +
          escapeHTML(question.question) +
          "</p>" +
          reviewOptionsHTML(question, record) +
          '<dl class="review-answers">' +
          '<div><dt>你的答案</dt><dd>' +
          escapeHTML(userAnswer) +
          "</dd></div>" +
          '<div><dt>正确答案</dt><dd class="correct-answer">' +
          escapeHTML(correctAnswer) +
          "</dd></div>" +
          "</dl>" +
          (question.explanation
            ? '<div class="review-explanation"><span>解析</span><p>' +
              escapeHTML(question.explanation) +
              "</p></div>"
            : "") +
          "</div>" +
          "</details>"
        );
      })
      .join("");

    app.innerHTML =
      '<main class="screen screen--result">' +
      '<header class="site-head">' +
      '<div class="brand"><span class="seal seal--small" aria-hidden="true">文</span>' +
      '<span class="brand-copy"><strong>文学常识</strong><small>本轮完成</small></span></div>' +
      '<span class="edition">成绩单</span>' +
      "</header>" +

      '<section class="result-hero" aria-labelledby="result-title">' +
      '<div class="result-seal" aria-hidden="true"><span>阅</span><small>' +
      correct +
      "/" +
      total +
      "</small></div>" +
      '<p class="eyebrow eyebrow--center"><span aria-hidden="true"></span>本轮完成</p>' +
      '<div class="score-ring' +
      (percentage >= 80 ? " score-ring--high" : "") +
      '" style="--score:' +
      percentage * 3.6 +
      'deg"><div><strong>' +
      correct +
      "</strong><span>/ " +
      total +
      "</span></div></div>" +
      '<h1 id="result-title">' +
      roundTitle(correct, total) +
      "</h1>" +
      '<p class="result-sub">答对 ' +
      correct +
      " 题，错 " +
      wrong +
      " 题" +
      (wrong ? "。错题已自动展开。" : "。") +
      "</p>" +
      '<div class="result-metrics">' +
      "<div><span>正确率</span><strong>" +
      percentage +
      "%</strong></div>" +
      "<div><span>用时</span><strong>" +
      formatDuration(elapsed) +
      "</strong></div>" +
      "<div><span>选择 / 填空</span><strong>" +
      choiceCorrect +
      "/" +
      choiceQuestions.length +
      " · " +
      fillCorrect +
      "/" +
      fillQuestions.length +
      "</strong></div>" +
      "</div>" +
      "</section>" +

      '<section class="review" aria-labelledby="review-title">' +
      '<div class="section-head"><div><p class="micro-label">REVIEW</p><h2 id="review-title">逐题回看</h2></div>' +
      "<span>" +
      (wrong ? wrong + " 道错题" : "全部正确") +
      "</span></div>" +
      '<div class="review-list">' +
      reviewHTML +
      "</div>" +
      "</section>" +

      '<div class="result-actions">' +
      '<button class="primary-button" type="button" data-action="retry"><span>再来一组</span><span class="button-tail" aria-hidden="true">↻</span></button>' +
      '<button class="ghost-button ghost-button--wide" type="button" data-action="home">回到首页</button>' +
      "</div>" +

      '<footer class="site-footer"><span>每一道错题，都是下一次的得分点</span><span class="footer-mark" aria-hidden="true">鲁</span></footer>' +
      "</main>";

    scrollTop();
  }

  /* ----------------------------- 事件 ----------------------------- */

  app.addEventListener("click", function (event) {
    const actionElement = event.target.closest("[data-action]");

    if (!actionElement) {
      const dialog = event.target.closest("dialog");
      if (dialog && event.target === dialog) dialog.close();
      return;
    }

    const action = actionElement.dataset.action;

    if (action === "start") {
      startRound();
    } else if (action === "select-all-categories") {
      setAllCategories(true);
    } else if (action === "select-none-categories") {
      setAllCategories(false);
    } else if (action === "quit") {
      const dialog = $("#quit-dialog");
      if (dialog && typeof dialog.showModal === "function") {
        dialog.showModal();
      } else if (window.confirm("退出本轮？当前答题记录不会保存。")) {
        goHome();
      }
    } else if (action === "close-dialog") {
      const dialog = actionElement.closest("dialog");
      if (dialog) dialog.close();
    } else if (action === "quit-confirm") {
      const dialog = actionElement.closest("dialog");
      if (dialog) dialog.close();
      goHome();
    } else if (action === "confirm") {
      submitCurrent();
    } else if (action === "next") {
      goToNext();
    } else if (action === "retry") {
      startRound();
    } else if (action === "home") {
      goHome();
    }
  });

  app.addEventListener("change", function (event) {
    const input = event.target;

    if (input.classList.contains("category-checkbox")) {
      if (input.checked) {
        state.selectedCategories.add(input.value);
      } else {
        state.selectedCategories.delete(input.value);
      }
      const chip = input.closest(".chip");
      if (chip) chip.classList.toggle("is-checked", input.checked);
      updateHomeSelectionUI();
      return;
    }

    if (input.matches('input[name="multi"]')) {
      if (state.submitted) return;
      const index = Number(input.value);
      if (input.checked) {
        if (state.multiSelected.indexOf(index) < 0) state.multiSelected.push(index);
      } else {
        state.multiSelected = state.multiSelected.filter(function (item) { return item !== index; });
      }
      state.multiSelected.sort(function (a, b) { return a - b; });
      input.closest(".option").classList.toggle("is-selected", input.checked);
      const button = $("#main-action");
      if (button) button.disabled = state.multiSelected.length === 0;
      return;
    }

    if (!input.matches('input[name="choice"]') || state.submitted) return;

    state.selected = Number(input.value);
    $$(".option").forEach(function (label) {
      label.classList.toggle("is-selected", label.contains(input));
    });

    const button = $("#main-action");
    if (button) button.disabled = false;
  });

  app.addEventListener("input", function (event) {
    const input = event.target;
    if (!input.classList.contains("blank-input") || state.submitted) return;
    const index = Number(input.dataset.blankIndex);
    if (Number.isInteger(index)) state.fillValues[index] = input.value;
  });

  app.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    if (!event.target.classList.contains("blank-input")) return;
    if (state.submitted) return;
    event.preventDefault();
    submitCurrent();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const dialog = $("#quit-dialog");
      if (dialog && dialog.open) dialog.close();
    }
  });

  /* ----------------------------- 启动 ----------------------------- */

  state.selectedCategories = new Set(
    getCategories().map(function (item) { return item.name; })
  );
  renderHome();
})();

/* global Papa — loaded from CDN in index.html */
"use strict";

(function (global) {
  const RT_CAP_MS = 30000;
  const NUM_Q = 30;

  const ageOrder = ["18-25", "26-35", "36-45", "46-55", "56-65", "65+"];
  const famOrder = ["自細漢講台語", "會聽bē講", "大漢才學"];
  const oralOrder = ["口語扭掠", "無kài輾轉", "干焦會曉聽"];
  const writtenOrder = ["書寫無問題", "學過無定用", "無學過書寫"];

  global.SURVEY_ORDERS = { ageOrder, famOrder, oralOrder, writtenOrder };

  /** 題目資料.csv：id, content, 互動性分組 … → 用於儀表板顯示內容 */
  function parseAudioOptions(raw) {
    if (raw === undefined || raw === null) return [];
    const txt = String(raw).trim();
    if (!txt) return [];
    try {
      const parsed = JSON.parse(txt);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((v) => String(v || "").trim()).filter((v) => !!v);
    } catch (_) {
      return [];
    }
  }

  function parseQuestionBankRows(rows) {
    const out = Array.from({ length: NUM_Q }, () => ({
      content: "",
      interactivity: "",
      options: [],
    }));
    rows.forEach((row) => {
      const id = Number(row.id);
      if (!Number.isFinite(id) || id < 1 || id > NUM_Q) return;
      out[id - 1] = {
        content: String(row.content || "").trim(),
        interactivity: String(row["互動性分組"] || "").trim(),
        options: parseAudioOptions(row.options),
      };
    });
    return out;
  }
  global.parseQuestionBankRows = parseQuestionBankRows;

  function normalizeAge(s) {
    if (!s) return null;
    let t = String(s)
      .trim()
      .replace(/\u2013/g, "-")
      .replace(/\u2014/g, "-");
    if (t === "65歲以上") return "65+";
    return /^(\d+)-(\d+)$/.test(t) ? t : null;
  }

  function normalizeFam(s) {
    const m = {
      "家裡以台語為主要語言，從小聽與說": "自細漢講台語",
      "在家聽得懂台語，但不會說": "會聽bē講",
      "家裡不太講台語，長大後才學會": "大漢才學",
    };
    return m[String(s || "").trim()] || null;
  }

  function normalizeOral(s) {
    const m = {
      對話流利: "口語扭掠",
      "無kài輾轉，但不順暢": "無kài輾轉",
      "聽得懂，但不太會說": "干焦會曉聽",
    };
    return m[String(s || "").trim()] || null;
  }

  function normalizeWritten(s) {
    const t = String(s || "").trim();
    if (!t) return null;
    if (/書寫\/?閱讀.*無礙/.test(t)) return "書寫無問題";
    if (/有大概學過讀寫/.test(t) && /實際使用/.test(t)) return "學過無定用";
    if (/完全沒學過/.test(t)) return "無學過書寫";
    return null;
  }

  function mean(arr) {
    if (!arr.length) return NaN;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function median(arr) {
    const a = arr
      .filter((x) => Number.isFinite(x))
      .slice()
      .sort((x, y) => x - y);
    if (!a.length) return NaN;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function parseParticipant(row) {
    const age = normalizeAge(row["年齡"]);
    const fam = normalizeFam(row["家庭台語背景"]);
    const oral = normalizeOral(row["臺語程度（口語）"]);
    const written = normalizeWritten(row["臺語程度（書面）"]);
    if (!age || !fam || !oral || !written) return null;
    const name = String(row["姓名"] || "").trim();
    const openText = String(row["聲音判斷依據（開放題）"] || "").trim();
    const scores = [];
    const rts = [];
    // qidByOrder[order-1] = qid; 用於「依照回答順序排列」
    // 若呈現順序資料不完整，最後會退回到依題目 ID 的排序。
    let qidByOrder = new Array(NUM_Q).fill(null);
    let okOrder = true;
    for (let q = 1; q <= NUM_Q; q++) {
      const sk = row[`${q}_回答結果`];
      const rtKey = `${q}_回答時間毫秒`;
      if (sk === undefined || sk === null || String(sk).trim() === "")
        return null;
      const sc = Number(sk);
      if (!Number.isFinite(sc) || sc < 1 || sc > 5) return null;
      const orderKey = `${q}_呈現順序`;
      const ordRaw = row[orderKey];
      const ord =
        ordRaw === "" || ordRaw === undefined || ordRaw === null
          ? NaN
          : Number(ordRaw);
      if (!Number.isFinite(ord) || ord < 1 || ord > NUM_Q) {
        okOrder = false;
      } else if (qidByOrder[ord - 1] != null) {
        okOrder = false; // 避免重複/不完整
      } else {
        qidByOrder[ord - 1] = q;
      }
      const rtRaw = row[rtKey];
      const rt =
        rtRaw === "" || rtRaw === undefined || rtRaw === null
          ? NaN
          : Number(rtRaw);
      if (!Number.isFinite(rt)) return null;
      scores.push(sc);
      rts.push(Math.min(RT_CAP_MS, rt));
    }
    if (!okOrder || qidByOrder.some((v) => v == null)) {
      // 退回：題目 ID 排序（1..30）
      qidByOrder = Array.from({ length: NUM_Q }, (_, i) => i + 1);
    }
    return {
      id: null, // 由 buildSurveyD 後續補上（用於 UI）
      name,
      openText,
      age,
      fam,
      oral,
      written,
      scores,
      rts,
      qidByOrder,
    };
  }

  function countInOrder(participants, getter, order) {
    const o = {};
    order.forEach((k) => {
      o[k] = 0;
    });
    participants.forEach((p) => {
      const v = getter(p);
      if (v in o) o[v]++;
    });
    return o;
  }

  /** 某背景組內，每位受試者於題組 [i0,i1) 十題的算術平均（每人一個值，供箱型圖） */
  function perPersonBlockMeans(participants, pred, i0, i1) {
    const out = [];
    participants.forEach((p) => {
      if (!pred(p)) return;
      const slice = p.scores.slice(i0, i1);
      out.push(mean(slice));
    });
    return out;
  }

  function buildGroupScores(participants) {
    const dims = [
      ["年齡", (p) => p.age, ageOrder],
      ["口語程度", (p) => p.oral, oralOrder],
      ["家庭台語背景", (p) => p.fam, famOrder],
      ["書面程度", (p) => p.written, writtenOrder],
    ];
    const out = {};
    dims.forEach(([name, getter, order]) => {
      out[name] = {};
      order.forEach((g) => {
        const pred = (p) => getter(p) === g;
        const n = participants.filter(pred).length;
        out[name][g] = {
          n,
          q1_10: perPersonBlockMeans(participants, pred, 0, 10),
          q11_20: perPersonBlockMeans(participants, pred, 10, 20),
          q21_30: perPersonBlockMeans(participants, pred, 20, 30),
        };
      });
    });
    return out;
  }

  /** 題組內每個分數 1–5 的回答筆數（逐題累計；每位受試者該段 10 題即 10 筆） */
  function countScoresInRange(participants, pred, i0, i1) {
    const counts = [0, 0, 0, 0, 0];
    participants.forEach((p) => {
      if (!pred(p)) return;
      for (let i = i0; i < i1; i++) {
        const s = p.scores[i];
        if (s >= 1 && s <= 5) counts[s - 1] += 1;
      }
    });
    return counts;
  }

  function buildGroupScoreCounts(participants) {
    const dims = [
      ["年齡", (p) => p.age, ageOrder],
      ["口語程度", (p) => p.oral, oralOrder],
      ["家庭台語背景", (p) => p.fam, famOrder],
      ["書面程度", (p) => p.written, writtenOrder],
    ];
    const out = {};
    dims.forEach(([name, getter, order]) => {
      out[name] = {};
      order.forEach((g) => {
        const pred = (p) => getter(p) === g;
        const n = participants.filter(pred).length;
        out[name][g] = {
          n,
          q1_10: countScoresInRange(participants, pred, 0, 10),
          q11_20: countScoresInRange(participants, pred, 10, 20),
          q21_30: countScoresInRange(participants, pred, 20, 30),
        };
      });
    });
    return out;
  }

  function rankArray(vals) {
    const n = vals.length;
    const idx = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    let k = 0;
    while (k < n) {
      let j = k;
      while (j < n && idx[j].v === idx[k].v) j++;
      const avg = (k + j + 1) / 2;
      for (let t = k; t < j; t++) ranks[idx[t].i] = avg;
      k = j;
    }
    return ranks;
  }

  function pearson(rx, ry) {
    const n = rx.length;
    if (n < 2) return 0;
    const mx = mean(rx);
    const my = mean(ry);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i++) {
      const a = rx[i] - mx;
      const b = ry[i] - my;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    if (dx * dy < 1e-20) return 0;
    return num / Math.sqrt(dx * dy);
  }

  function spearmanRho(x, y) {
    return pearson(rankArray(x), rankArray(y));
  }

  function erfApprox(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y =
      1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normalCDF(x) {
    return 0.5 * (1 + erfApprox(x / Math.SQRT2));
  }

  /** 大樣本近似的 Spearman 雙尾 p（與常用統計軟體可能略有差異） */
  function spearmanPApprox(rho, n) {
    if (n < 3) return 1;
    const z = rho * Math.sqrt(n - 1);
    return 2 * (1 - normalCDF(Math.abs(z)));
  }

  function sigStars(p) {
    if (p < 0.001) return "***";
    if (p < 0.01) return "**";
    if (p < 0.05) return "*";
    return "n.s.";
  }

  function buildSpearman(participants) {
    const n = participants.length;
    const ordMap = {
      年齡: (p) => ageOrder.indexOf(p.age) + 1,
      家庭台語背景: (p) => famOrder.indexOf(p.fam) + 1,
      口語程度: (p) => oralOrder.indexOf(p.oral) + 1,
      書面程度: (p) => writtenOrder.indexOf(p.written) + 1,
    };
    const y1 = (p) => mean(p.scores.slice(0, 10));
    const y2 = (p) => mean(p.scores.slice(10, 20));
    const y3 = (p) => mean(p.scores.slice(20, 30));
    const outcomes = [
      ["題1-10", y1],
      ["題11-20", y2],
      ["題21-30", y3],
    ];
    const demKeys = ["家庭台語背景", "口語程度", "書面程度", "年齡"];
    const out = {};
    demKeys.forEach((d) => {
      out[d] = {};
      const xv = participants.map(ordMap[d]);
      outcomes.forEach(([label, fn]) => {
        const yv = participants.map(fn);
        const rho = spearmanRho(xv, yv);
        const p = spearmanPApprox(rho, n);
        out[d][label] = {
          rho: Math.round(rho * 1000) / 1000,
          p,
          sig: sigStars(p),
        };
      });
    });
    return out;
  }

  function crosstabMeans(participants, getRow, getCol, rowOrder, colOrder) {
    const data = {};
    rowOrder.forEach((r) => {
      colOrder.forEach((c) => {
        const cell = participants.filter(
          (p) => getRow(p) === r && getCol(p) === c,
        );
        const n = cell.length;
        const key = `${r}×${c}`;
        if (n === 0) {
          data[key] = { n: 0, q1_10: null, q11_20: null, q21_30: null };
        } else {
          data[key] = {
            n,
            q1_10: mean(cell.flatMap((p) => p.scores.slice(0, 10))),
            q11_20: mean(cell.flatMap((p) => p.scores.slice(10, 20))),
            q21_30: mean(cell.flatMap((p) => p.scores.slice(20, 30))),
          };
        }
      });
    });
    return data;
  }

  function top3SlowRt(participants, pred) {
    const subs = participants.filter(pred);
    const n = subs.length;
    if (n === 0) return { n: 0, top3: [] };
    const medByQ = [];
    for (let q = 0; q < NUM_Q; q++) {
      const vals = subs.map((p) => p.rts[q]);
      medByQ.push({ q: q + 1, rt: median(vals) });
    }
    medByQ.sort((a, b) => b.rt - a.rt);
    return { n, top3: medByQ.slice(0, 3) };
  }

  function buildHardQuestions(participants) {
    return {
      年齡: Object.fromEntries(
        ageOrder.map((g) => [g, top3SlowRt(participants, (p) => p.age === g)]),
      ),
      口語程度: Object.fromEntries(
        oralOrder.map((g) => [
          g,
          top3SlowRt(participants, (p) => p.oral === g),
        ]),
      ),
      家庭台語背景: Object.fromEntries(
        famOrder.map((g) => [g, top3SlowRt(participants, (p) => p.fam === g)]),
      ),
      書面程度: Object.fromEntries(
        writtenOrder.map((g) => [
          g,
          top3SlowRt(participants, (p) => p.written === g),
        ]),
      ),
    };
  }

  function zscoreRow(row) {
    const valid = row.filter((v) => Number.isFinite(v));
    if (!valid.length) return row.map(() => 0);
    const mu = mean(valid);
    const varp = valid.reduce((s, v) => s + (v - mu) ** 2, 0) / valid.length;
    const sigma = Math.sqrt(varp);
    if (sigma < 1e-9) return row.map(() => 0);
    return row.map((v) => (Number.isFinite(v) ? (v - mu) / sigma : 0));
  }

  function buildRtHeatmap(participants) {
    const blocks = [
      { order: ageOrder, key: "age" },
      { order: oralOrder, key: "oral" },
      { order: famOrder, key: "fam" },
      { order: writtenOrder, key: "written" },
    ];
    const labels = [];
    const raw_matrix = [];
    blocks.forEach((b) => {
      b.order.forEach((label) => {
        const subs = participants.filter((p) => p[b.key] === label);
        const n = subs.length;
        labels.push(`${label} (n=${n})`);
        const row = [];
        for (let q = 0; q < NUM_Q; q++) {
          const vals = subs.map((p) => p.rts[q]);
          row.push(median(vals));
        }
        raw_matrix.push(row);
      });
    });
    const z_matrix = raw_matrix.map(zscoreRow);
    const group_info = [
      { name: "年齡", start: 0, count: ageOrder.length },
      { name: "口語程度", start: ageOrder.length, count: oralOrder.length },
      {
        name: "家庭台語背景",
        start: ageOrder.length + oralOrder.length,
        count: famOrder.length,
      },
      {
        name: "書面程度",
        start: ageOrder.length + oralOrder.length + famOrder.length,
        count: writtenOrder.length,
      },
    ];
    return { labels, group_info, z_matrix, raw_matrix };
  }

  function buildSurveyD(flatRows) {
    const participants = [];
    flatRows.forEach((row, idx) => {
      const p = parseParticipant(row);
      if (p) {
        // 以「有效受試者序號」作為 UI 顯示/選擇用 id（不依賴姓名）
        p.id = participants.length + 1;
        p._rowIndex = idx;
        participants.push(p);
      }
    });
    if (!participants.length) throw new Error("沒有任何完整有效問卷列");

    const demographics = {
      年齡: countInOrder(participants, (p) => p.age, ageOrder),
      家庭台語背景: countInOrder(participants, (p) => p.fam, famOrder),
      口語程度: countInOrder(participants, (p) => p.oral, oralOrder),
      書面程度: countInOrder(participants, (p) => p.written, writtenOrder),
    };

    const per_question_scores = {};
    const per_question_rt = {};
    for (let q = 1; q <= NUM_Q; q++) {
      per_question_scores[String(q)] = participants.map((p) => p.scores[q - 1]);
      per_question_rt[String(q)] = median(
        participants.map((p) => p.rts[q - 1]),
      );
    }

    return {
      demographics,
      participants,
      per_question_scores,
      per_question_rt,
      group_scores: buildGroupScores(participants),
      group_score_counts: buildGroupScoreCounts(participants),
      spearman: buildSpearman(participants),
      crosstab_fam_oral: crosstabMeans(
        participants,
        (p) => p.fam,
        (p) => p.oral,
        famOrder,
        oralOrder,
      ),
      crosstab_fam_written: crosstabMeans(
        participants,
        (p) => p.fam,
        (p) => p.written,
        famOrder,
        writtenOrder,
      ),
      crosstab_age_oral: crosstabMeans(
        participants,
        (p) => p.age,
        (p) => p.oral,
        ageOrder,
        oralOrder,
      ),
      crosstab_age_written: crosstabMeans(
        participants,
        (p) => p.age,
        (p) => p.written,
        ageOrder,
        writtenOrder,
      ),
      crosstab_age_fam: crosstabMeans(
        participants,
        (p) => p.age,
        (p) => p.fam,
        ageOrder,
        famOrder,
      ),
      group_hard_questions: buildHardQuestions(participants),
      rt_heatmap: buildRtHeatmap(participants),
    };
  }

  global.buildSurveyD = buildSurveyD;
})(typeof window !== "undefined" ? window : globalThis);

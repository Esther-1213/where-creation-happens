/*
 * Where Does Creation Happen?
 * 화면 · 관객의 선택 · 설문 · 재생 · 다운로드 연결
 *
 * 먼저 필요한 파일:
 * data.js
 * engine.js
 * piano-pcm.js
 * compat-audio.js
 */

"use strict";


/* ── 기본 상태 ────────────────────────── */

const $ = selector => document.querySelector(selector);
const app = $("#app");

const POLL_KEY = "living-votes-v2";

function readStorage(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function defaultConfig() {
  return {
    group: "drought",
    photo: "space",
    cond: "filter",
    pigment: "on",
    water: "sustain",
    direction: "normal"
  };
}

let lang = readStorage("living-lang", "ko");

if (!["ko", "en"].includes(lang)) {
  lang = "ko";
}

let step = 0;
let vote = null;
let after = null;
let interpret = "protect";
let config = defaultConfig();

let playing = false;
let busy = false;
let completed = false;

let timer = null;
let soundCheckTimer = null;
let soundChecking = false;
let toastTimer = null;

let audioMode = "tone";
let activeAudio = "tone";

const t = (korean, english) =>
  lang === "ko" ? korean : english;


/* ── 질문과 네 가지 선택지 ────────────── */

function themes() {
  return [
    t("결과", "Outcome"),
    t("과정", "Process"),
    t("의도", "Intention"),
    t("해석", "Interpretation")
  ];
}

function meanings() {
  return [
    t("완성된 작품 자체", "The finished work itself"),
    t("만들어가는 경험", "The experience of making"),
    t("무엇을 표현하고 싶은가", "What you want to express"),
    t("어떤 의미를 발견하는가", "The meaning you discover")
  ];
}

function question() {
  return t(
    "AI가 음악을 만들어줄 수 있는 시대에,<br>당신은 창작에서 무엇을 가장 중요하게 생각하나요?",
    "In an age when AI can make music for you,<br>what do you value most in creation?"
  );
}


/* ── 관객이 선택할 비유적 해석 ────────── */

function stories() {
  return {
    protect: {
      title: t(
        "거리를 두는 방식",
        "A way of keeping distance"
      ),
      label: t("자기 보호", "Self-protection"),
      text: t(
        "닫힘을 단절보다 자신을 지키기 위한 선택으로 읽습니다.",
        "Read closure as a choice to protect oneself."
      ),
      photo: "space",
      direction: "normal"
    },

    pause: {
      title: t(
        "멈춤에도 리듬이 있다",
        "Even a pause has rhythm"
      ),
      label: t("활동의 조절", "A measured pause"),
      text: t(
        "활동의 감소를 다음 움직임을 위한 여백으로 읽습니다.",
        "Read reduced activity as space before another movement."
      ),
      photo: "pitch",
      direction: "normal"
    },

    return: {
      title: t(
        "돌아오는 다른 길",
        "Another way back"
      ),
      label: t(
        "다르게 이어가기",
        "Continuing differently"
      ),
      text: t(
        "회복을 이전 상태의 복제보다 새로운 이어짐으로 읽습니다.",
        "Read recovery as continuation, not a copy of the past."
      ),
      photo: "pitch",
      direction: "invert"
    }
  };
}


/* ── 알림과 공통 도구 ─────────────────── */

function toast(message) {
  const element = $("#toast");

  clearTimeout(toastTimer);

  element.textContent = message;
  element.style.display = "block";

  toastTimer = setTimeout(() => {
    element.style.display = "none";
  }, 4500);
}

function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}

function treatmentName(group) {
  return {
    drought: t("가뭄", "Drought"),
    nitrogen: t("질소 결핍", "Nitrogen deficit"),
    control: t("대조군", "Control")
  }[group];
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds));

  const minutes = String(
    Math.floor(value / 60)
  ).padStart(2, "0");

  const remaining = String(
    value % 60
  ).padStart(2, "0");

  return `${minutes}:${remaining}`;
}

function saveFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 15000);
}

function saveJSON(value, filename) {
  saveFile(
    new Blob(
      [JSON.stringify(value, null, 2)],
      { type: "application/json" }
    ),
    filename
  );
}


/* ── 단계 표시 ────────────────────────── */

function steps() {
  const labels = [
    t("무엇이 중요한가", "What matters"),
    t("관찰", "Observe"),
    t("해석", "Interpret"),
    t("음악적 결정", "Compose"),
    t("나의 작품", "Your score")
  ];

  return `
    <div class="stepnav">
      ${labels.map((label, index) => `
        <span class="${step === index + 1 ? "on" : ""}">
          0${index + 1} / ${label}
        </span>
      `).join("")}
    </div>
  `;
}

function choice(label, description, index, selected, attributes) {
  return `
    <button
      type="button"
      class="choice ${selected ? "selected" : ""}"
      aria-pressed="${selected}"
      ${attributes}
    >
      <span class="num">0${index + 1}</span>
      <strong>${label}</strong>
      <p>${description}</p>
    </button>
  `;
}


/* ── 첫 화면의 개념 그래픽 ────────────── */

function art() {
  let lines = "";

  for (let index = 0; index < 32; index++) {
    const x = 90 + index * 8;

    lines += `
      <path
        d="
          M${x},335
          C${x - 150},${175 + index * 2}
           ${440 - index * 4},${90 + index * 3}
           ${270 + index * 2},40
        "
      />
    `;
  }

  const points = PLANT_DATA.groups.drought;

  const x = day => 65 + day / 14 * 370;
  const y = value => 315 - value * 19;

  const path = points.map((point, index) =>
    `${index ? "L" : "M"}${x(point.day)},${y(point.photo.mean)}`
  ).join(" ");

  return `
    <div class="hero-art">
      <div class="sun"></div>

      <div class="art-title">
        <span>FIG. 01 / A LIVING SCORE</span>
        <span>SOLANUM LYCOPERSICUM</span>
      </div>

      <svg viewBox="0 0 500 380" aria-hidden="true">
        <g
          fill="none"
          stroke="#314d35"
          stroke-width=".8"
          opacity=".6"
        >
          ${lines}
        </g>

        <path
          d="${path}"
          fill="none"
          stroke="#865d70"
          stroke-width="1.5"
        />

        <g fill="#d68da3">
          ${points.map(point => `
            <circle
              cx="${x(point.day)}"
              cy="${y(point.photo.mean)}"
              r="8"
            />
          `).join("")}
        </g>

        <g fill="#354832" font-size="10">
          ${points.map(point => `
            <text x="${x(point.day) - 15}" y="360">
              DAY ${String(point.day).padStart(2, "0")}
            </text>
          `).join("")}
        </g>
      </svg>

      <div class="art-bottom">
        <span>
          ${t(
            "다섯 번의 관찰.<br>하나의 정답 없는 악보.",
            "Five observations.<br>An open-ended score."
          )}

          <br>

          <span class="small">
            ${t(
              "가뭄군 광합성률과 개념 선화를 결합한 그래픽",
              "Drought photosynthesis data with conceptual linework"
            )}
          </span>
        </span>

        <strong>
          14<span style="font-size:12px"> DAYS</span>
        </strong>
      </div>

      <div class="grain"></div>
    </div>
  `;
}


/* ── 실제 데이터 그래프 ──────────────── */

function chart() {
  const selected = PLANT_DATA.groups[config.group];
  const control = PLANT_DATA.groups.control;

  const x = day => 40 + day / 14 * 550;
  const y = value => 220 - value / 11 * 180;

  const path = points =>
    points.map((point, index) =>
      `${index ? "L" : "M"}${x(point.day)},${y(point.photo.mean)}`
    ).join(" ");

  return `
    <svg
      class="chart"
      viewBox="0 0 640 270"
      role="img"
      aria-label="${t(
        "날짜별 순광합성률 평균, 선택군과 대조군 비교",
        "Mean net photosynthesis by day, selected group and control"
      )}"
    >
      <rect
        x="315"
        y="20"
        width="275"
        height="200"
        fill="#d3e5b4"
        opacity=".5"
      />

      <g stroke="#bdc5b6" stroke-width=".7">
        ${[0, 3, 6, 9].map(value => `
          <path d="M40 ${y(value)}H590"/>
        `).join("")}
      </g>

      <g fill="#64745c" font-size="10">
        ${[0, 3, 6, 9].map(value => `
          <text x="10" y="${y(value) + 4}">
            ${value}
          </text>
        `).join("")}

        ${PLANT_DATA.days.map(day => `
          <text x="${x(day) - 8}" y="245">
            d${day}
          </text>
        `).join("")}

        <text x="330" y="40">
          ${t("회복 처리 시작", "Recovery begins")} ↗
        </text>
      </g>

      <path
        d="${path(control)}"
        fill="none"
        stroke="#a48089"
        stroke-width="2"
        stroke-dasharray="4 5"
      />

      <path
        d="${path(selected)}"
        fill="none"
        stroke="#273f2c"
        stroke-width="2.5"
      />

      ${selected.map(point => `
        <circle
          cx="${x(point.day)}"
          cy="${y(point.photo.mean)}"
          r="4"
          fill="#273f2c"
        />

        <text
          x="${x(point.day) - 12}"
          y="${y(point.photo.mean) - 13}"
          fill="#273f2c"
          font-size="11"
        >
          ${point.photo.mean.toFixed(2)}
        </text>
      `).join("")}
    </svg>
  `;
}

function dataTable() {
  const points = PLANT_DATA.groups[config.group];

  return `
    <details class="data-details">
      <summary>
        ${t(
          "매핑에 쓰는 실제 평균값 보기",
          "Inspect the actual mapped means"
        )} ↗
      </summary>

      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>DAY</th>
              <th>Photo / n</th>
              <th>Cond / n</th>
              <th>Water</th>
              <th>Root</th>
              <th>Chl a : b : β</th>
            </tr>
          </thead>

          <tbody>
            ${points.map(point => {
              const total = point.pigments.reduce(
                (sum, value) => sum + value,
                0
              );

              const ratios = point.pigments
                .map(value =>
                  (value / total * 100).toFixed(1)
                )
                .join(" : ");

              return `
                <tr>
                  <td>
                    ${point.day}${point.sharedBaseline ? "*" : ""}
                  </td>
                  <td>
                    ${point.photo.mean.toFixed(3)}
                    / ${point.photo.n}
                  </td>
                  <td>
                    ${point.cond.mean.toFixed(4)}
                    / ${point.cond.n}
                  </td>
                  <td>
                    ${(point.water.mean * 100).toFixed(1)}%
                  </td>
                  <td>
                    ${(point.root.mean * 100).toFixed(1)}%
                  </td>
                  <td>${ratios}%</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>

      <p class="note">
        ${t(
          "* d0는 공통 초기 대조군입니다. Water는 지상부 수분 질량 비율, Root는 전체 건조중량 중 뿌리 비율입니다. 색소는 선택한 세 성분 내 비율입니다.",
          "* d0 is the common control baseline. Water is shoot water mass fraction; Root is the root fraction of total dry mass. Pigments are proportions within the three selected components."
        )}
      </p>
    </details>
  `;
}


/* ── 응답 읽기 ────────────────────────── */

function getVotes() {
  try {
    const rows = JSON.parse(
      readStorage(POLL_KEY, "[]")
    );

    if (!Array.isArray(rows)) return [];

    return rows.filter(row =>
      row &&
      row.schemaVersion === 2 &&
      Number.isInteger(row.after) &&
      row.after >= 0 &&
      row.after < 4
    );
  } catch {
    return [];
  }
}


/* ── 돌과 용기 ────────────────────────── */

function jarChoices(phase) {
  const afterPhase = phase === "after";
  const rows = getVotes();

  const selected = afterPhase ? after : vote;
  const field = afterPhase ? "after" : "before";

  const englishLabels = [
    "OUTCOME",
    "PROCESS",
    "INTENTION",
    "INTERPRETATION"
  ];

  return themes().map((label, index) => {
    const count = rows.filter(
      row => row[field] === index
    ).length;

    let stones = "";

    // 그림은 최대 36개까지, 숫자는 전체 응답 수를 표시합니다.
    for (
      let stone = 0;
      stone < Math.min(count, 36);
      stone++
    ) {
      const x = 66 + stone * 31 % 115;
      const y = 224 - Math.floor(stone / 7) * 13;
      const rotation = stone * 39 % 90;

      const color = [
        "#b4bdab",
        "#84927c",
        "#cbd0c0"
      ][stone % 3];

      stones += `
        <ellipse
          cx="${x}"
          cy="${y}"
          rx="10"
          ry="6.3"
          fill="${color}"
          transform="rotate(${rotation} ${x} ${y})"
        />
      `;
    }

    const pending = selected === index && !completed;

    if (pending) {
      stones += `
        <ellipse
          class="falling-pebble"
          cx="125"
          cy="212"
          rx="12"
          ry="8"
          fill="#d1f583"
        />
      `;
    }

    const gradientID = `glass-${phase}-${index}`;

    return `
      <button
        type="button"
        class="choice vessel ${selected === index ? "selected" : ""}"
        data-${afterPhase ? "after" : "vote"}="${index}"
        aria-pressed="${selected === index}"
        ${afterPhase && completed ? "disabled" : ""}
      >
        <span class="vessel-index">
          0${index + 1} / ${englishLabels[index]}
        </span>

        <svg viewBox="0 0 250 270" aria-hidden="true">
          <defs>
            <linearGradient
              id="${gradientID}"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop
                stop-color="#ffffff"
                stop-opacity=".12"
              />
              <stop
                offset=".45"
                stop-color="#ffffff"
                stop-opacity=".015"
              />
              <stop
                offset="1"
                stop-color="#ffffff"
                stop-opacity=".09"
              />
            </linearGradient>
          </defs>

          <path
            d="M55 61L55 221Q55 245 125 245Q195 245 195 221V61"
            fill="url(#${gradientID})"
            stroke="#aab5a0"
            stroke-width="1.2"
          />

          <ellipse
            cx="125"
            cy="61"
            rx="70"
            ry="15"
            fill="none"
            stroke="#aab5a0"
            stroke-width="1.2"
          />

          <path
            d="M65 78V207"
            stroke="#dae4cf"
            stroke-width="2"
            opacity=".35"
          />

          ${stones}

          <ellipse
            cx="125"
            cy="230"
            rx="65"
            ry="12"
            fill="none"
            stroke="#aab5a0"
            opacity=".3"
          />

          <text
            x="125"
            y="149"
            text-anchor="middle"
            fill="${selected === index ? "#d1f583" : "#a7aea2"}"
            font-family="serif"
            font-size="36"
          >
            ${count + (pending ? 1 : 0)}
          </text>
        </svg>

        <strong>${label}</strong>
        <p>${meanings()[index]}</p>

        <span class="vessel-action">
          ${selected === index
            ? t("돌을 놓았습니다", "Pebble placed")
            : t("돌 하나 놓기 ↘", "Place a pebble ↘")}
        </span>
      </button>
    `;
  }).join("");
}


/* ── 전후 집계 ────────────────────────── */

function poll() {
  const rows = getVotes();

  const beforeCounts = [0, 0, 0, 0];
  const afterCounts = [0, 0, 0, 0];

  for (const row of rows) {
    if (
      Number.isInteger(row.before) &&
      row.before >= 0 &&
      row.before < 4
    ) {
      beforeCounts[row.before]++;
    }

    afterCounts[row.after]++;
  }

  return `
    <p class="note">
      ${t(
        "이 브라우저에 쌓인 응답",
        "Responses on this browser"
      )}: ${rows.length}

      · ${t(
        "연두: 체험 전 / 로즈: 체험 후 · 서버 전체 집계가 아닙니다.",
        "Lime: before / rose: after · not a global tally."
      )}
    </p>

    <div class="poll">
      ${themes().map((label, index) => `
        <div class="poll-row">
          <span>${label}</span>

          <div class="double-track">
            <i style="
              width:${rows.length
                ? beforeCounts[index] / rows.length * 100
                : 0}%
            "></i>

            <i style="
              width:${rows.length
                ? afterCounts[index] / rows.length * 100
                : 0}%
            "></i>
          </div>

          <span>
            ${beforeCounts[index]} / ${afterCounts[index]}
          </span>
        </div>
      `).join("")}
    </div>
  `;
}


/* ── 매핑 선택 컴포넌트 ──────────────── */

function mapping(key, title, description, options) {
  return `
    <div class="panel">
      <span class="tag">
        ${t(
          "데이터 → 예술적 규칙",
          "DATA → ARTISTIC RULE"
        )}
      </span>

      <h3>${title}</h3>
      <p class="note">${description}</p>

      <select
        data-map="${key}"
        aria-label="${escapeHTML(title)}"
      >
        ${options.map(([value, label]) => `
          <option
            value="${value}"
            ${config[key] === value ? "selected" : ""}
          >
            ${label}
          </option>
        `).join("")}
      </select>
    </div>
  `;
}


/* ── 재생 컨트롤 ──────────────────────── */

function transport() {
  return `
    <div class="audio-source">
      <label>
        ${t("재생 엔진", "Audio engine")}

        <select id="audioMode">
          <option
            value="tone"
            ${audioMode === "tone" ? "selected" : ""}
          >
            Tone.js
          </option>

          <option
            value="compat"
            ${audioMode === "compat" ? "selected" : ""}
          >
            ${t(
              "로컬 호환 · 외부 연결 없이",
              "Local compatibility · no external connection"
            )}
          </option>
        </select>
      </label>

      <span id="engineStatus">
        ${t(
          "Tone.js 불가 시 호환 재생을 알립니다.",
          "Fallback playback is explicitly labeled."
        )}
      </span>
    </div>

    <div class="transport">
      <button type="button" class="primary" id="play">
        ${playing ? "■" : "▶"}
        ${playing
          ? t("정지", "Stop")
          : t("들어보기", "Listen")}
      </button>

      <button type="button" class="secondary" id="compare">
        ${t("기본 규칙 듣기", "Hear default")}
      </button>

      <span class="phase" id="phase">
        DAY 00 / ${t("시작", "Start")}
      </span>

      <div class="timeline">
        <span id="progress"></span>
      </div>

      <span class="timer" id="time">
        00:00 / ${formatTime(ScoreEngine.DURATION)}
      </span>

      <label class="control small">
        VOL
        <input
          id="volume"
          type="range"
          min="-30"
          max="-3"
          value="-9"
          aria-label="${t("음량", "Volume")}"
        >
      </label>
    </div>
  `;
}


/* ── 선택 기록 표시 ──────────────────── */

function receipt() {
  return `
    ${t("광합성", "Photosynthesis")}
    →
    ${config.photo === "pitch"
      ? t("음역", "register")
      : t("발음 밀도", "density")}

    (${config.direction === "invert"
      ? t("음역 반전", "inverted register")
      : t("정방향", "direct")})

    <br>

    ${t("기공", "Conductance")}
    →
    ${config.cond === "filter"
      ? t("밝기", "brightness")
      : t("좌우 공간", "pan")}

    <br>

    ${t("색소 균형", "Pigment balance")}
    →
    ${config.pigment === "on"
      ? t("데이터 연결", "data mapping")
      : t("고정", "fixed")}

    <br>

    ${t("수분", "Water")}
    →
    ${config.water === "sustain"
      ? t("지속시간", "sustain")
      : t("고정 길이", "fixed duration")}

    <br>

    ${t(
      "뿌리 건조중량 비율 → 베이스 음량 (작가 고정 매핑)",
      "Root dry mass ratio → bass level (author-fixed mapping)"
    )}
  `;
}


/* ── 화면 0: 시작 ────────────────────── */

function homePage() {
  return `
    <div class="hero">
      <section>
        <p class="eyebrow">
          AN EXPERIMENT IN AUTHORSHIP / 2026
        </p>

        <h1>
          Where does<br>
          <em>creation</em><br>
          happen?
        </h1>

        <p class="subtitle">
          ${t(
            "식물은 환경에 반응합니다.<br>당신은 그 반응을 어떻게 음악으로 읽을까요?",
            "A plant responds to its environment.<br>How will you read that response as music?"
          )}
        </p>

        <div class="actions">
          <button type="button" class="primary" id="begin">
            ${t("나의 악보 시작하기", "Begin your score")} ↗
          </button>

          <button
            type="button"
            class="secondary"
            id="soundcheck"
          >
            ${t("헤드폰 소리 확인", "Check headphone sound")} ♫
          </button>

          <span class="meta dim">
            ${t(
              "약 3–4분 · 헤드폰 권장",
              "3–4 MIN · HEADPHONES"
            )}
          </span>
        </div>

        <p class="note">
          ${t(
            "실제 토마토 생리 데이터와 당신의 결정으로 연주됩니다.<br>생성형 AI 음악을 사용하지 않습니다.",
            "Performed from real tomato physiology data and your decisions.<br>No generative AI music."
          )}
        </p>
      </section>

      ${art()}
    </div>
  `;
}


/* ── 화면 1: 첫 번째 돌 ──────────────── */

function beforePage() {
  return steps() + `
    <div class="pagehead">
      <div>
        <p class="eyebrow">BEFORE YOU MAKE / 01</p>
        <h2>${question()}</h2>
      </div>

      <p>
        ${t(
          "지금의 생각 하나를 골라주세요. 체험이 끝나면 다시 묻겠습니다. 정답은 없습니다.",
          "Choose one. We will ask again after your experience. There is no correct answer."
        )}
      </p>
    </div>

    <div class="cards">
      ${jarChoices("before")}
    </div>

    <div class="actions">
      <button
        type="button"
        class="primary"
        id="next"
        ${vote === null ? "disabled" : ""}
      >
        ${t("식물 관찰하기", "Observe the plant")} →
      </button>
    </div>

    <p class="note">
      ${t(
        "용기를 눌러 돌 하나를 놓아주세요. 전후 선택은 마지막에 응답을 남길 때 이 브라우저에 저장됩니다. 쌓인 돌은 이전 응답이며 개인정보는 수집하지 않습니다.",
        "Click a vessel to place a pebble. Before-and-after choices are saved in this browser when you submit at the end. Accumulated pebbles represent earlier responses. No personal data is collected."
      )}
    </p>
  `;
}


/* ── 화면 2: 관찰 ────────────────────── */

function observePage() {
  const points = PLANT_DATA.groups[config.group];
  const day7 = points[3];
  const day14 = points[4];

  return steps() + `
    <div class="pagehead">
      <div>
        <p class="eyebrow">OBSERVE / 02</p>

        <h2>
          ${t(
            "닫히고, 줄어들고.<br>다시 움직이기까지.",
            "Closing. Slowing.<br>Moving again."
          )}
        </h2>
      </div>

      <div class="radio-row">
        ${["drought", "nitrogen", "control"].map(group => `
          <button
            type="button"
            class="pill ${config.group === group ? "selected" : ""}"
            data-group="${group}"
          >
            ${treatmentName(group)}
          </button>
        `).join("")}
      </div>
    </div>

    <div class="workspace">
      <div class="panel paper">
        <div class="charttop">
          <span>NET PHOTOSYNTHESIS / PAR 300</span>
          <span>DAY 00 → 14</span>
        </div>

        <div class="legend">
          <span>━ ${t("선택군", "Selected")}</span>
          <span>┄ ${t("대조군", "Control")}</span>
        </div>

        ${chart()}

        <div class="statgrid">
          <div class="stat">
            DAY 07 / PHOTO
            <strong>${day7.photo.mean.toFixed(2)}</strong>
            n = ${day7.photo.n}
          </div>

          <div class="stat">
            DAY 14 / PHOTO
            <strong>${day14.photo.mean.toFixed(2)}</strong>
            n = ${day14.photo.n}
          </div>

          <div class="stat">
            DAY 07 / WATER
            <strong>
              ${(day7.water.mean * 100).toFixed(1)}%
            </strong>
            (FW − DW) / FW
          </div>
        </div>

        ${dataTable()}

        <p class="note">
          ${t(
            "점은 측정일별 평균이며 선은 시각적 연결입니다. 중간 날짜는 측정하지 않았습니다. 평균 차이가 통계적 유의성을 뜻하지는 않습니다.",
            "Dots are day-level means; lines connect observations. Intermediate days were not measured. Differences in means do not establish statistical significance."
          )}
        </p>
      </div>

      <div class="panel">
        <span class="tag">
          ${t("생리적 사실", "PHYSIOLOGICAL FACT")}
        </span>

        <h3>
          ${t("환경에 반응하는 토마토", "A tomato responds")}
        </h3>

        <p class="note">
          ${t(
            "이 실험은 대조군·가뭄·질소 결핍 조건의 토마토를 14일 동안 관찰했습니다. 7일째 회복 처리를 시작했습니다. 기공전도도는 잎의 기체 교환과 관련된 지표이고, 순광합성률은 탄소 동화의 순수지를 나타냅니다.",
            "The experiment observed control, drought and nitrogen-deficient tomatoes over 14 days. Recovery treatment began on day 7. Stomatal conductance relates to leaf gas exchange; net photosynthesis describes the net carbon assimilation balance."
          )}
        </p>

        <span class="tag">
          ${t("아직 해석하지 않은 것", "NOT AN EMOTION")}
        </span>

        <p class="note">
          ${t(
            "수치로 식물의 감정을 판정하지 않습니다. 다음 단계에서 붙이는 인간의 이야기는 관객의 비유적 해석입니다.",
            "These values do not identify plant emotions. The human story in the next step is your metaphorical interpretation."
          )}
        </p>

        <a
          class="inline-link"
          href="${PLANT_DATA.source}"
          target="_blank"
          rel="noopener"
        >
          ${t("데이터 출처 열기", "Open data source")} ↗
        </a>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="secondary" id="back">
        ←
      </button>

      <button type="button" class="primary" id="next">
        ${t("나의 관점으로 읽기", "Read it your way")} →
      </button>
    </div>
  `;
}


/* ── 화면 3: 해석 ────────────────────── */

function interpretPage() {
  return steps() + `
    <div class="pagehead">
      <div>
        <p class="eyebrow">INTERPRET / 03</p>

        <h2>
          ${t(
            "변화에 어떤 이야기를<br>붙이고 싶나요?",
            "What story will you<br>give this change?"
          )}
        </h2>
      </div>

      <p>
        ${t(
          "이 문장은 식물의 마음을 설명하지 않습니다. 관찰한 현상에서 당신이 발견한 인간의 이야기입니다. 해석은 음악 규칙의 출발점이며 다음 화면에서 직접 바꿀 수 있습니다.",
          "These words do not describe the plant’s mind. They are human stories you find in its response. A story suggests a starting rule; you can change that rule next."
        )}
      </p>
    </div>

    <div
      class="cards"
      style="grid-template-columns:repeat(3,minmax(0,1fr))"
    >
      ${Object.entries(stories()).map(
        ([key, story], index) =>
          choice(
            story.label,
            story.text,
            index,
            interpret === key,
            `data-story="${key}"`
          )
      ).join("")}
    </div>

    <div class="panel title-line">
      <span class="small dim">
        ${t(
          "선택한 이야기에서 가져온 작품 제목",
          "A TITLE FROM YOUR INTERPRETATION"
        )}
      </span>

      <h3 class="scoretitle" style="font-size:35px">
        ${stories()[interpret].title}
      </h3>

      <p class="note">
        ${t(
          "이야기를 고른 것만으로 음악이 결정되지는 않습니다. 어떤 소리가 이 이야기를 표현할지 직접 결정하세요.",
          "Choosing a story does not finish the music. Decide which sounds will express it."
        )}
      </p>
    </div>

    <div class="actions">
      <button type="button" class="secondary" id="back">
        ←
      </button>

      <button type="button" class="primary" id="next">
        ${t(
          "소리의 연결 결정하기",
          "Decide the connections"
        )} →
      </button>
    </div>
  `;
}


/* ── 화면 4: 음악적 결정 ──────────────── */

function composePage() {
  return steps() + `
    <div class="pagehead">
      <div>
        <p class="eyebrow">DECIDE / 04</p>

        <h2>
          ${t(
            "같은 현상.<br>다르게 들리는 선택.",
            "The same observation.<br>A different decision."
          )}
        </h2>
      </div>

      <p>
        ${t(
          "한 번 들어본 뒤 연결을 바꾸고 다시 들어보세요. 재생 중에는 규칙을 고정하여 어떤 선택을 들었는지 명확히 합니다.",
          "Listen, change one connection, and listen again. Rules remain fixed during each playback so you know which choices you heard."
        )}
      </p>
    </div>

    <div class="mapping">
      ${mapping(
        "photo",
        t("광합성률 →", "Photosynthesis →"),
        t(
          "값의 높낮이를 어디에 드러낼까요?",
          "Where should differences in value be heard?"
        ),
        [
          [
            "pitch",
            t(
              "음역 · 높을수록 높은 음",
              "Register · higher values, higher notes"
            )
          ],
          [
            "space",
            t(
              "발음 밀도 · 낮을수록 긴 쉼",
              "Density · lower values, more silence"
            )
          ]
        ]
      )}

      ${mapping(
        "cond",
        t("기공전도도 →", "Conductance →"),
        t(
          "열리고 닫히는 통로를 어떻게 읽을까요?",
          "How will you express an opening or closing passage?"
        ),
        [
          [
            "filter",
            t(
              "밝기 · 높을수록 필터가 열림",
              "Brightness · higher values open the filter"
            )
          ],
          [
            "space",
            t(
              "공간 · 값에 따라 좌우로 이동",
              "Space · values move sound left to right"
            )
          ]
        ]
      )}

      ${mapping(
        "pigment",
        t(
          "선택한 세 색소의 비율 →",
          "Three selected pigment ratios →"
        ),
        t(
          "엽록소 a·b·β카로틴 농도의 상대 비율",
          "Relative concentrations of chlorophyll a, b and β-carotene"
        ),
        [
          [
            "on",
            t(
              "음색 균형 · 필터와 배음층 음량",
              "Timbre balance · filter and harmonic layer"
            )
          ],
          [
            "off",
            t(
              "고정 · 색소 매핑 사용 안 함",
              "Fixed · leave pigment mapping off"
            )
          ]
        ]
      )}

      ${mapping(
        "water",
        t(
          "지상부 수분 비율 →",
          "Shoot water mass fraction →"
        ),
        t(
          "(FW−DW)/FW · 일반적인 RWC와 다릅니다.",
          "(FW−DW)/FW · not classical relative water content."
        ),
        [
          [
            "sustain",
            t(
              "지속 · 높을수록 길게 머무름",
              "Sustain · higher values linger longer"
            )
          ],
          [
            "fixed",
            t(
              "고정 · 같은 길이로 연주",
              "Fixed · keep duration constant"
            )
          ]
        ]
      )}
    </div>

    <div class="actions">
      <label class="small dim">
        ${t(
          "광합성 매핑 방향",
          "Photosynthesis mapping direction"
        )}

        <select
          id="direction"
          style="
            background:var(--bg);
            color:var(--paper);
            border:1px solid var(--line);
            padding:8px;
          "
        >
          <option
            value="normal"
            ${config.direction === "normal" ? "selected" : ""}
          >
            ${t("정방향", "Direct")}
          </option>

          <option
            value="invert"
            ${config.direction === "invert" ? "selected" : ""}
          >
            ${t(
              "반전 · 음역에 적용",
              "Invert · register only"
            )}
          </option>
        </select>
      </label>
    </div>

    ${transport()}

    <p class="note">
      ${t(
        "고정: 76 BPM / 4분의 4박자 / C major·D Dorian 공통 음집합 / Dm7–G7–Cmaj7–Fmaj7 / 12마디. 회복을 장조 전환으로 강제하지 않습니다.",
        "Fixed: 76 BPM / 4⁄4 / shared C major–D Dorian pitch set / Dm7–G7–Cmaj7–Fmaj7 / 12 bars. Recovery does not force a major-key change."
      )}
    </p>

    <div class="actions">
      <button type="button" class="secondary" id="back">
        ←
      </button>

      <button type="button" class="primary" id="next">
        ${t(
          "이 선택으로 작품 만들기",
          "Keep these decisions"
        )} →
      </button>
    </div>
  `;
}


/* ── 화면 5: 작품과 마지막 돌 ────────── */

function resultPage() {
  const beforeLabel = vote === null
    ? "—"
    : themes()[vote];

  const shift = after === null
    ? t(
        "같은 질문, 두 번째 돌. 지금의 생각을 놓아주세요.",
        "The same question. A second pebble. Place your thought here."
      )
    : `${t("체험 전", "Before")} ${beforeLabel}
       → ${t("체험 후", "After")} ${themes()[after]}`;

  return steps() + `
    <div class="result-grid">
      <section>
        <p class="eyebrow">YOUR LIVING SCORE / 05</p>

        <h2 class="scoretitle">
          ${stories()[interpret].title}
        </h2>

        <p class="dim">
          ${t(
            "한 식물의 감정이 아닌, 당신이 선택한 표현.",
            "Not a plant’s emotion. An expression you chose."
          )}
        </p>

        <div class="bars" aria-hidden="true">
          ${Array.from({ length: 48 }, (_, index) => `
            <i style="
              --h:${15 + Math.abs(Math.sin(index * 1.7)) * 85}%;
              --d:${index * 0.035}s
            "></i>
          `).join("")}
        </div>

        ${transport()}

        <div class="actions">
          <button type="button" class="primary" id="download">
            WAV ↓
          </button>

          <button type="button" class="secondary" id="record">
            ${t("창작 기록 JSON", "Decision record")} ↓
          </button>

          <button type="button" class="secondary" id="share">
            ${t("재현 링크 복사", "Copy replay link")} ↗
          </button>
        </div>

        <p class="note">
          ${t(
            "WAV는 이 기기에서 렌더링됩니다. 재현 링크는 같은 규칙으로 다시 연주하며 오디오 파일을 서버에 업로드하지 않습니다.",
            "WAV is rendered on this device. The replay link recreates the same rules; no audio file is uploaded."
          )}
        </p>

        <div id="qr" class="qrcode"></div>

        <button
          type="button"
          class="secondary small"
          id="qrBtn"
        >
          ${t("재현 링크 QR 표시", "Show replay-link QR")}
        </button>

        <p class="note">
          ${t(
            "QR 생성 시 재현 링크가 외부 QR 서비스로 전송됩니다. 다른 기기에서 열려면 공개 호스팅 주소가 필요합니다.",
            "Generating a QR sends the replay URL to an external QR service. Cross-device access requires a publicly reachable host."
          )}
        </p>
      </section>

      <aside class="panel">
        <span class="tag">DECISION RECEIPT</span>

        <dl class="receipt">
          <dt>
            ${t("관찰한 조건", "Observed treatment")}
          </dt>
          <dd>
            ${treatmentName(config.group)}
            / PAR 300 / d0 → d14
          </dd>

          <dt>${t("나의 해석", "Your interpretation")}</dt>
          <dd>${stories()[interpret].label}</dd>

          <dt>${t("나의 연결 규칙", "Your mappings")}</dt>
          <dd>${receipt()}</dd>

          <dt>
            ${t("작가가 고정한 것", "Author constraints")}
          </dt>
          <dd>
            76 BPM · 4/4 · 12 bars<br>
            Dm7 / G7 / Cmaj7 / Fmaj7
          </dd>

          <dt>${t("소리의 재료", "Sound materials")}</dt>
          <dd id="soundLabel">
            ${t(
              "Tone.js: 온라인 그랜드피아노 샘플 우선. 로컬 호환: 합성 피아노·베이스·드럼. 실제 재생 엔진은 재생 후 표시됩니다.",
              "Tone.js: online grand piano samples preferred. Local compatibility: synthesized piano, bass and drums. The active engine is shown after playback."
            )}
          </dd>
        </dl>

        <button type="button" class="secondary" id="back">
          ← ${t("선택 다시 바꾸기", "Edit decisions")}
        </button>
      </aside>
    </div>

    <section class="title-line">
      <p class="eyebrow">AFTER YOU MAKE</p>

      <h3 class="end-title">${question()}</h3>

      <div class="cards">
        ${jarChoices("after")}
      </div>

      <div class="actions">
        <button
          type="button"
          class="primary"
          id="submit"
          ${after === null || completed ? "disabled" : ""}
        >
          ${completed
            ? t("기록했습니다", "Recorded")
            : t("나의 응답 남기기", "Leave your response")} ↗
        </button>

        <button type="button" class="secondary" id="restart">
          ${t(
            "다음 관객 · 처음으로",
            "Next visitor · restart"
          )}
        </button>

        <button
          type="button"
          class="secondary"
          id="exportVotes"
        >
          ${t(
            "이 브라우저 응답 내려받기",
            "Export local responses"
          )} ↓
        </button>
      </div>

      <p class="choice-shift">${shift}</p>

      <div id="poll">${poll()}</div>

      <p class="eyebrow" style="margin-top:40px">
        WHERE DOES CREATION HAPPEN?
      </p>
    </section>
  `;
}


/* ── 화면 그리기 ──────────────────────── */

function render() {
  document.documentElement.lang = lang;

  $("#langBtn").textContent =
    lang === "ko" ? "EN" : "한국어";

  $("#rulesBtn").textContent =
    t("작곡의 규칙 ↗", "The rules ↗");

  $("#footnote").textContent = t(
    "생리적 사실에서, 당신의 해석으로.",
    "From physiological facts to your interpretation."
  );

  const pages = [
    homePage,
    beforePage,
    observePage,
    interpretPage,
    composePage,
    resultPage
  ];

  app.innerHTML = pages[step]();

  bind();

  if (playing) {
    app.classList.add("playing");
    updateProgress();
  } else {
    app.classList.remove("playing");
  }
}


/* ── 재생 상태와 잠금 ────────────────── */

function setControls(disabled) {
  app.querySelectorAll(
    "select, #next, #back, #download, #record, #share, " +
    "#qrBtn, #restart, #submit, #exportVotes, [data-after]"
  ).forEach(element => {
    element.disabled = disabled;
  });

  if (!disabled) {
    if ($("#submit")) {
      $("#submit").disabled =
        after === null || completed;
    }

    if (completed) {
      app.querySelectorAll("[data-after]")
        .forEach(element => {
          element.disabled = true;
        });
    }
  }
}

function stop() {
  clearInterval(timer);
  clearTimeout(soundCheckTimer);

  timer = null;
  soundCheckTimer = null;
  soundChecking = false;

  if (window.ScoreEngine) {
    ScoreEngine.stop();
  }

  if (window.CompatAudio) {
    CompatAudio.stop();
  }

  playing = false;

  app.classList.remove("playing");

  if ($("#play")) {
    $("#play").textContent =
      "▶ " + t("들어보기", "Listen");
  }

  if ($("#soundcheck")) {
    $("#soundcheck").textContent =
      t("헤드폰 소리 확인", "Check headphone sound") + " ♫";
  }

  setControls(false);
}


/* ── 첫 화면: 외부 파일 없는 소리 확인 ─ */

async function checkSound() {
  if (busy) return;

  if (soundChecking) {
    stop();
    return;
  }

  stop();
  busy = true;

  const button = $("#soundcheck");

  if (button) {
    button.disabled = true;
    button.textContent = t(
      "소리 준비 중…",
      "Preparing sound…"
    );
  }

  try {
    await CompatAudio.unlock();

    const preview = ScoreEngine.build(
      defaultConfig()
    );

    await CompatAudio.play(preview);

    soundChecking = true;

    if (button) {
      button.textContent = t(
        "소리 확인 정지 ■",
        "Stop sound check ■"
      );
    }

    toast(t(
      "8초 로컬 호환 음원 · 합성 피아노·베이스·드럼",
      "8-second local compatibility preview · synthesized instruments"
    ));

    soundCheckTimer = setTimeout(() => {
      stop();
    }, 8000);
  } catch (error) {
    stop();

    toast(t(
      "오디오 출력을 확인한 뒤 다시 눌러주세요.",
      "Check your audio output and press again."
    ));

    console.error(error);
  } finally {
    busy = false;

    if (button) {
      button.disabled = false;
    }
  }
}


/* ── 음악 재생 ────────────────────────── */

async function start(defaults = false) {
  if (busy) return;

  if (playing) {
    stop();
    return;
  }

  stop();

  busy = true;
  setControls(true);

  if ($("#play")) {
    $("#play").disabled = true;
    $("#play").textContent = t(
      "소리 준비 중…",
      "Preparing sound…"
    );
  }

  try {
    // 클릭 직후 호환 오디오 컨텍스트를 활성화합니다.
    await CompatAudio.unlock();

    const selectedConfig = defaults
      ? {
          ...config,
          photo: "pitch",
          cond: "filter",
          pigment: "off",
          water: "fixed",
          direction: "normal"
        }
      : { ...config };

    const score = ScoreEngine.build(selectedConfig);

    activeAudio = audioMode;

    if (audioMode === "tone") {
      try {
        await ScoreEngine.play(selectedConfig);
      } catch (error) {
        console.warn(
          "Tone.js unavailable; using explicitly labeled compatibility audio.",
          error
        );

        ScoreEngine.stop();

        activeAudio = "compat";
        audioMode = "compat";

        if ($("#audioMode")) {
          $("#audioMode").value = "compat";
        }

        await CompatAudio.play(score);

        toast(t(
          "Tone.js 연결 실패 · 로컬 호환 음원으로 재생합니다.",
          "Tone.js unavailable · playing local compatibility audio."
        ));
      }
    } else {
      await CompatAudio.play(score);
    }

    const volume = Number(
      $("#volume")?.value ?? -9
    );

    if (activeAudio === "tone" && window.Tone) {
      Tone.Destination.volume.value = volume;
    } else {
      CompatAudio.setVolume(volume);
    }

    playing = true;
    app.classList.add("playing");

    if ($("#play")) {
      $("#play").textContent =
        "■ " + t("정지", "Stop");
    }

    if ($("#engineStatus")) {
      $("#engineStatus").textContent =
        (
          activeAudio === "tone"
            ? "TONE.JS"
            : t(
                "로컬 호환 · 합성 피아노",
                "LOCAL COMPAT · SYNTH PIANO"
              )
        ) +
        " / " +
        (
          defaults
            ? t("기본 규칙", "DEFAULT RULES")
            : t("나의 규칙", "YOUR RULES")
        );
    }

    updateSoundLabel();

    timer = setInterval(
      updateProgress,
      100
    );
  } catch (error) {
    stop();

    toast(t(
      "재생을 시작하지 못했습니다. 버튼을 한 번 더 눌러주세요.",
      "Playback could not start. Please press play once more."
    ));

    console.error(error);
  } finally {
    busy = false;

    setControls(playing);

    if ($("#play")) {
      $("#play").disabled = false;

      if (!playing) {
        $("#play").textContent =
          "▶ " + t("들어보기", "Listen");
      }
    }
  }
}

function updateSoundLabel() {
  const element = $("#soundLabel");

  if (!element) return;

  if (activeAudio === "compat") {
    element.textContent = t(
      "로컬 호환 엔진 / 합성 피아노·베이스·드럼. Tone.js 재생과 구분됩니다.",
      "Local compatibility engine / synthesized piano, bass and drums. Distinct from Tone.js playback."
    );
  } else if (ScoreEngine.sampled()) {
    element.textContent = t(
      "Tone.js / Salamander 그랜드피아노 샘플 · 합성 저음·드럼",
      "Tone.js / Salamander grand piano samples · synthesized bass and drums"
    );
  } else {
    element.textContent = t(
      "Tone.js / 로컬 합성 피아노 · 합성 저음·드럼",
      "Tone.js / local synthesized piano, bass and drums"
    );
  }
}

function updateProgress() {
  if (!playing) return;

  const seconds = activeAudio === "compat"
    ? CompatAudio.elapsed()
    : ScoreEngine.elapsed();

  // 마지막 마디 시작에 d14가 대응됩니다.
  const lastBarStart =
    ScoreEngine.DURATION * 11 / 12;

  const day = Math.min(
    14,
    seconds / lastBarStart * 14
  );

  if ($("#progress")) {
    $("#progress").style.width =
      Math.min(
        100,
        seconds / ScoreEngine.DURATION * 100
      ) + "%";
  }

  if ($("#time")) {
    $("#time").textContent =
      `${formatTime(seconds)} / ` +
      formatTime(ScoreEngine.DURATION);
  }

  if ($("#phase")) {
    const phase = day >= 7
      ? t("회복処理", "Recovery")
      : day >= 2
        ? t("반응", "Response")
        : t("시작", "Start");

    $("#phase").textContent =
      `DAY ${day.toFixed(1)} / ${phase}`;
  }

  if (seconds > ScoreEngine.DURATION + 2) {
    stop();
  }
}


/* ── WAV 다운로드 ────────────────────── */

async function downloadWav() {
  if (busy) return;

  stop();
  busy = true;
  setControls(true);

  const button = $("#download");

  if (button) {
    button.textContent = t(
      "WAV 만드는 중…",
      "Rendering WAV…"
    );
  }

  try {
    let blob;
    let usedCompatibility = false;

    if (
      activeAudio === "compat" ||
      audioMode === "compat"
    ) {
      blob = CompatAudio.wav(
        ScoreEngine.build(config)
      );

      usedCompatibility = true;
    } else {
      try {
        blob = await ScoreEngine.render(config);
        activeAudio = "tone";
      } catch (error) {
        console.warn(
          "Tone.js render unavailable; using compatibility renderer.",
          error
        );

        blob = CompatAudio.wav(
          ScoreEngine.build(config)
        );

        usedCompatibility = true;
      }
    }

    if (usedCompatibility) {
      activeAudio = "compat";
      updateSoundLabel();
    }

    saveFile(blob, "living-score.wav");

    toast(
      usedCompatibility
        ? t(
            "로컬 호환 음원으로 WAV를 저장했습니다.",
            "WAV saved with local compatibility audio."
          )
        : t(
            "Tone.js 음원으로 WAV를 저장했습니다.",
            "WAV saved with Tone.js audio."
          )
    );
  } catch (error) {
    toast(t(
      "WAV를 만들지 못했습니다. 로컬 호환 모드로 다시 시도해주세요.",
      "Could not render WAV. Try local compatibility mode."
    ));

    console.error(error);
  } finally {
    busy = false;
    setControls(false);

    if (button) {
      button.textContent = "WAV ↓";
    }
  }
}


/* ── 기록과 재현 링크 ────────────────── */

function decisionRecord() {
  return {
    schemaVersion: 2,

    pollCategories: [
      "outcome",
      "process",
      "intention",
      "interpretation"
    ],

    audioEngine: activeAudio,
    title: stories()[interpret].title,
    interpretation: interpret,

    decisions: { ...config },

    before: vote,
    after,

    score: ScoreEngine.build(config),
    dataSource: PLANT_DATA.source,

    notes:
      "Rule-based; no generative AI. " +
      "Group means; common d0 baseline. " +
      "Intermediate musical controls are interpolated, not measured."
  };
}

function replayURL() {
  const url = new URL(location.href);

  url.hash = "score=" + encodeURIComponent(
    JSON.stringify({
      c: config,
      i: interpret
    })
  );

  return url.href;
}

async function copyReplayLink() {
  try {
    await navigator.clipboard.writeText(
      replayURL()
    );

    toast(t(
      "재현 링크를 복사했습니다.",
      "Replay link copied."
    ));
  } catch {
    window.prompt(
      t("이 링크를 복사하세요.", "Copy this link."),
      replayURL()
    );
  }
}

function showQR() {
  const container = $("#qr");

  if (!container) return;

  container.style.display = "block";
  container.innerHTML = "";

  const image = document.createElement("img");

  image.alt = t(
    "음악 선택 재현 링크 QR",
    "Score replay link QR"
  );

  image.src =
    "https://api.qrserver.com/v1/create-qr-code/" +
    "?size=180x180&data=" +
    encodeURIComponent(replayURL());

  image.onerror = () => {
    container.style.display = "none";

    toast(t(
      "QR 서비스에 연결하지 못했습니다. 재현 링크 복사를 사용해주세요.",
      "QR service unavailable. Please copy the replay link."
    ));
  };

  container.append(image);
}


/* ── 응답 저장과 재시작 ──────────────── */

function submitVote() {
  if (
    busy ||
    completed ||
    after === null
  ) {
    return;
  }

  stop();

  const rows = getVotes();

  rows.push({
    schemaVersion: 2,

    categories: [
      "outcome",
      "process",
      "intention",
      "interpretation"
    ],

    before: vote,
    after,

    interpretation: interpret,
    decisions: { ...config },

    timestamp: new Date().toISOString()
  });

  const saved = writeStorage(
    POLL_KEY,
    JSON.stringify(rows)
  );

  if (!saved) {
    toast(t(
      "이 브라우저에 응답을 저장할 수 없습니다.",
      "This browser cannot save responses."
    ));

    return;
  }

  completed = true;
  render();

  toast(t(
    "당신의 돌을 기록했습니다.",
    "Your pebble has been recorded."
  ));
}

function restart() {
  if (busy) return;

  stop();

  step = 0;
  vote = null;
  after = null;
  completed = false;

  interpret = "protect";
  config = defaultConfig();

  // 재현 링크로 방문했더라도 다음 관객은 새로 시작합니다.
  if (location.hash.startsWith("#score=")) {
    history.replaceState(
      null,
      "",
      location.pathname + location.search
    );
  }

  render();
  window.scrollTo(0, 0);
}


/* ── 버튼 이벤트 연결 ────────────────── */

function onClick(selector, handler) {
  const element = $(selector);

  if (element) {
    element.addEventListener("click", handler);
  }
}

function bind() {
  onClick("#soundcheck", checkSound);

  onClick("#begin", () => {
    if (busy) return;

    stop();
    step = 1;

    render();
    window.scrollTo(0, 0);
  });

  onClick("#next", () => {
    if (busy) return;

    stop();

    if (step === 3) {
      const story = stories()[interpret];

      config.photo = story.photo;
      config.direction = story.direction;
    }

    step = Math.min(5, step + 1);

    render();
    window.scrollTo(0, 0);
  });

  onClick("#back", () => {
    if (busy) return;

    stop();
    step = Math.max(0, step - 1);

    render();
    window.scrollTo(0, 0);
  });

  app.querySelectorAll("[data-vote]")
    .forEach(button => {
      button.onclick = () => {
        if (busy) return;

        vote = Number(button.dataset.vote);
        render();
      };
    });

  app.querySelectorAll("[data-group]")
    .forEach(button => {
      button.onclick = () => {
        if (busy) return;

        config.group = button.dataset.group;
        render();
      };
    });

  app.querySelectorAll("[data-story]")
    .forEach(button => {
      button.onclick = () => {
        if (busy) return;

        interpret = button.dataset.story;
        render();
      };
    });

  app.querySelectorAll("[data-map]")
    .forEach(select => {
      select.onchange = event => {
        stop();

        config[select.dataset.map] =
          event.target.value;
      };
    });

  if ($("#direction")) {
    $("#direction").onchange = event => {
      stop();
      config.direction = event.target.value;
    };
  }

  if ($("#audioMode")) {
    $("#audioMode").onchange = event => {
      stop();
      audioMode = event.target.value;
    };
  }

  onClick("#play", () => start());

  onClick("#compare", () => {
    if (busy) return;

    stop();
    start(true);
  });

  if ($("#volume")) {
    $("#volume").oninput = event => {
      const value = Number(event.target.value);

      if (window.Tone) {
        Tone.Destination.volume.value = value;
      }

      CompatAudio.setVolume(value);
    };
  }

  onClick("#download", downloadWav);

  onClick("#record", () => {
    saveJSON(
      decisionRecord(),
      "living-score-decisions.json"
    );
  });

  onClick("#share", copyReplayLink);
  onClick("#qrBtn", showQR);

  app.querySelectorAll("[data-after]")
    .forEach(button => {
      button.onclick = () => {
        if (completed || busy) return;

        stop();

        after = Number(button.dataset.after);
        render();
      };
    });

  onClick("#submit", submitVote);
  onClick("#restart", restart);

  onClick("#exportVotes", () => {
    saveJSON(
      {
        schemaVersion: 2,

        categories: [
          "outcome",
          "process",
          "intention",
          "interpretation"
        ],

        scope: "this-browser-only",
        exportedAt: new Date().toISOString(),

        responses: getVotes()
      },
      "living-score-local-responses.json"
    );
  });
}


/* ── 작가의 규칙 모달 ────────────────── */

function showRules() {
  const rows = [
    [
      t("데이터", "Data"),
      t(
        "PAR 300, 날짜 × 처리군 평균. NaN 제외. d0는 공통 대조군 기준. 파일끼리 개체를 임의 연결하지 않습니다.",
        "PAR 300, day × treatment means. NaN excluded. Day 0 is a common control baseline. Individuals are not joined across files."
      )
    ],

    [
      t("정규화", "Normalization"),
      t(
        "세 처리군·다섯 날짜의 평균 전체에서 min–max 정규화합니다. 군별로 따로 늘리지 않아 비교 범위를 유지합니다.",
        "Min–max normalization uses means across all three groups and five days. A common scale preserves between-group comparison."
      )
    ],

    [
      t("시간", "Time"),
      t(
        "실험 14일을 12마디, 약 38초로 압축합니다. 마디별 날짜를 선형 보간합니다. d7 이후는 회복 처리 구간이며 중간 수치는 측정값이 아닙니다.",
        "14 days become 12 bars, about 38 seconds. Day-level values are interpolated per bar. Recovery treatment begins at d7. Intermediate values are not observations."
      )
    ],

    [
      t("화성·리듬", "Harmony / rhythm"),
      t(
        "76 BPM · 4/4 · Dm7–G7–Cmaj7–Fmaj7. 피아노는 코드 구성음을 사용합니다. 일부 오프비트는 70ms 늦추며 베이스도 화음 안의 음으로 구성합니다.",
        "76 BPM · 4/4 · Dm7–G7–Cmaj7–Fmaj7. Piano uses chord tones. Some offbeats are delayed by 70 ms. Bass also stays within the harmony."
      )
    ],

    [
      t("매핑", "Mapping"),
      t(
        "Parameter-mapping sonification 방식으로 데이터를 소리 요소에 연결합니다. 구체적인 대응과 방향은 작가·관객의 예술적 결정이며 보편 법칙이 아닙니다.",
        "Parameter-mapping sonification connects data to audible parameters. These specific pairings and directions are artistic decisions, not universal laws."
      )
    ],

    [
      t("색소", "Pigments"),
      t(
        "W·X·Z 농도 열을 사용하고 선택한 세 색소의 합으로 나눕니다. 엽록소 a는 필터 배율, 엽록소 b는 피아노 음량, β카로틴은 배음층 음량에 연결합니다. 피아노 샘플 파형 자체를 교체하는 기능은 아닙니다.",
        "Concentration columns W/X/Z are normalized by the sum of the three selected pigments. Chl a scales filtering, Chl b piano gain, and β-carotene harmonic-layer gain. This does not replace the piano sample waveform."
      )
    ],

    [
      t("생리와 해석", "Fact / metaphor"),
      t(
        "수분은 지상부 수분 질량 비율이며 일반적인 RWC가 아닙니다. NPQ·Fv/Fm은 데이터에 보존하지만 현재 작곡에는 사용하지 않습니다. 해석 문구는 식물 감정의 과학적 증거가 아닙니다.",
        "Water is shoot water mass fraction, not classical RWC. NPQ and Fv/Fm are retained but unused by this score. Story text is not scientific evidence of plant emotions."
      )
    ],

    [
      t("오디오", "Audio"),
      t(
        "Tone.js를 우선 시도합니다. 연결 실패 시 로컬 호환 엔진을 사용하고 화면에 표시합니다. 호환 엔진은 Tone.js 자체가 아니며 합성 피아노·저음·드럼을 사용합니다.",
        "Tone.js is attempted first. If unavailable, a visibly labeled local compatibility engine is used. That renderer is not Tone.js and uses synthesized piano, bass and drums."
      )
    ],

    [
      t("응답", "Responses"),
      t(
        "결과·과정·의도·해석 중 체험 전후 선택을 이 브라우저에 저장합니다. 서버 전체 집계가 아니며 운영자는 JSON을 내려받아 보관할 수 있습니다.",
        "Before-and-after choices among outcome, process, intention and interpretation stay in this browser. This is not a global tally. An operator can export JSON."
      )
    ]
  ];

  $("#rulesContent").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>${t("영역", "Domain")}</th>
          <th>${t("규칙과 이유", "Rule and rationale")}</th>
        </tr>
      </thead>

      <tbody>
        ${rows.map(([label, content]) => `
          <tr>
            <td>${label}</td>
            <td>${content}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <p>
      Source:
      <a
        href="${PLANT_DATA.source}"
        target="_blank"
        rel="noopener"
      >
        Van Wittenberghe / PHOTOFLUX,
        Zenodo 12800065
      </a>

      <br>

      Related paper: doi:10.1111/nph.20253

      <br>

      Tone.js 14.8.49 — MIT.
      Salamander Grand Piano samples —
      Alexander Holm, CC BY 3.0.

      <br>

      ${t(
        "코드 제작과 설명 초안에 AI를 사용했습니다. 관객 체험 중 생성형 AI 음악을 생성하지 않습니다.",
        "AI assisted coding and drafting. No generative AI music is created during the visitor experience."
      )}
    </p>
  `;

  $("#rules").showModal();
}


/* ── 헤더 이벤트 ──────────────────────── */

$("#home").onclick = event => {
  event.preventDefault();

  if (busy) return;

  stop();
  step = 0;

  render();
  window.scrollTo(0, 0);
};

$("#langBtn").onclick = () => {
  if (busy) return;

  stop();

  lang = lang === "ko" ? "en" : "ko";

  writeStorage("living-lang", lang);
  render();
};

$("#rulesBtn").onclick = showRules;

$("#closeRules").onclick = () => {
  $("#rules").close();
};

window.addEventListener("pagehide", stop);


/* ── 재현 링크로 방문한 경우 ──────────── */

function restoreReplayLink() {
  if (!location.hash.startsWith("#score=")) {
    return;
  }

  try {
    const replay = JSON.parse(
      decodeURIComponent(
        location.hash.slice(7)
      )
    );

    const allowed = {
      group: ["drought", "nitrogen", "control"],
      photo: ["space", "pitch"],
      cond: ["filter", "space"],
      pigment: ["on", "off"],
      water: ["sustain", "fixed"],
      direction: ["normal", "invert"]
    };

    for (const key of Object.keys(allowed)) {
      if (allowed[key].includes(replay.c?.[key])) {
        config[key] = replay.c[key];
      }
    }

    if (
      ["protect", "pause", "return"].includes(replay.i)
    ) {
      interpret = replay.i;
    }

    step = 5;
  } catch (error) {
    console.warn("Invalid replay link", error);
  }
}


/* ── 시작 ──────────────────────────────── */

restoreReplayLink();
render();
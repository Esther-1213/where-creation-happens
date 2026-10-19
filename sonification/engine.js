/*
 * Where Does Creation Happen?
 * 규칙 기반 작곡 및 Tone.js 오디오 엔진
 *
 * 생성형 AI를 사용하지 않습니다.
 * 같은 데이터와 선택은 같은 음표·제어값을 만듭니다.
 * 노이즈 악기의 미세 파형은 달라질 수 있습니다.
 */

window.ScoreEngine = (() => {
  /* ── 작가가 고정한 음악 규칙 ───────── */

  const BPM = 76;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;
  const BARS = 12;
  const DURATION = BARS * BAR;

  // MIDI 음번호:
  // Dm7 → G7 → Cmaj7 → Fmaj7
  const CHORDS = [
    [50, 53, 57, 60],
    [55, 59, 62, 65],
    [48, 52, 55, 59],
    [53, 57, 60, 64]
  ];

  let loading = null;
  let samplerReady = false;
  let pianoBuffers = null;

  let live = null;
  let started = 0;


  /* ── Tone.js 로딩 ──────────────────── */

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let done = false;

      const timeout = url.startsWith("vendor") ? 800 : 2500;

      const timer = setTimeout(() => {
        finish(false);
      }, timeout);

      function finish(ok) {
        if (done) return;

        done = true;
        clearTimeout(timer);

        if (!ok) {
          script.remove();
          reject(
            new Error("Audio library unavailable: " + url)
          );
          return;
        }

        resolve();
      }

      script.src = url;
      script.onload = () => finish(true);
      script.onerror = () => finish(false);

      document.head.append(script);
    });
  }

  async function tone() {
    if (window.Tone) return;

    if (!loading) {
      loading = (async () => {
        try {
          // 로컬 파일이 있으면 먼저 사용합니다.
          await loadScript("./vendor/Tone.js");
        } catch {
          try {
            await loadScript(
              "https://cdn.jsdelivr.net/npm/tone@14.8.49/build/Tone.js"
            );
          } catch {
            await loadScript(
              "https://unpkg.com/tone@14.8.49/build/Tone.js"
            );
          }
        }

        if (!window.Tone) {
          throw new Error("Tone.js unavailable");
        }
      })();
    }

    try {
      await loading;
    } catch (error) {
      loading = null;
      throw error;
    }
  }


  /* ── 데이터 정규화 ────────────────── */

  function norm(key, value) {
    // 세 처리군·다섯 날짜에 공통인 범위를 사용합니다.
    const values = Object.values(PLANT_DATA.groups)
      .flat()
      .map(point => point[key].mean);

    const min = Math.min(...values);
    const max = Math.max(...values);

    const normalized = (value - min) / (max - min || 1);

    return Math.max(0, Math.min(1, normalized));
  }


  /* ── 날짜 사이의 음악적 보간 ──────── */

  function at(group, day) {
    const points = PLANT_DATA.groups[group];

    // 음악에서 사용하는 날짜는 실험 범위 안으로 제한합니다.
    const targetDay = Math.max(
      points[0].day,
      Math.min(points[points.length - 1].day, day)
    );

    const index = points.findIndex(
      point => point.day >= targetDay
    );

    if (index <= 0) {
      return points[0];
    }

    const before = points[index - 1];
    const after = points[index];

    const amount =
      (targetDay - before.day) /
      (after.day - before.day);

    const point = {
      day: targetDay
    };

    const keys = [
      "photo",
      "cond",
      "npq",
      "water",
      "root"
    ];

    for (const key of keys) {
      point[key] = {
        mean:
          before[key].mean * (1 - amount) +
          after[key].mean * amount
      };
    }

    point.pigments = before.pigments.map(
      (value, pigmentIndex) =>
        value * (1 - amount) +
        after.pigments[pigmentIndex] * amount
    );

    // 보간한 값은 실제 중간 날짜의 측정값이 아닙니다.
    return point;
  }


  /* ── 선택과 데이터로 악보 만들기 ──── */

  function build(config) {
    const notes = [];
    const frames = [];

    for (let bar = 0; bar < BARS; bar++) {
      const day = (14 * bar) / (BARS - 1);
      const point = at(config.group, day);

      const photo = norm("photo", point.photo.mean);
      const cond = norm("cond", point.cond.mean);
      const water = norm("water", point.water.mean);
      const root = norm("root", point.root.mean);

      const chord = CHORDS[bar % CHORDS.length];
      const time = bar * BAR;

      // 광합성률 → 발음 밀도 또는 음역
      const density =
        config.photo === "space"
          ? 1 + Math.round(photo * 3)
          : 3;

      // 방향 반전은 음역 매핑에 적용합니다.
      const level =
        config.direction === "invert"
          ? 1 - photo
          : photo;

      const pigmentTotal = point.pigments.reduce(
        (sum, value) => sum + value,
        0
      );

      const pigmentRatios = point.pigments.map(
        value => value / pigmentTotal
      );

      // 마디별 음향 제어값
      frames.push({
        time,
        day,

        // 기공전도도 → 필터 또는 좌우 공간
        cutoff:
          config.cond === "filter"
            ? 450 + cond * 4200
            : 2600,

        pan:
          config.cond === "space"
            ? (cond - 0.5) * 0.7
            : 0,

        // 선택한 세 색소 안에서의 구성비
        timbre:
          config.pigment === "on"
            ? pigmentRatios
            : [0.7, 0.22, 0.08]
      });


      /* 피아노 선율 */

      const positions = [0, 1.5, 2.5, 3.25];

      for (let note = 0; note < density; note++) {
        const offset =
          positions[note] * BEAT +
          (note % 2 ? 0.07 : 0);

        const chordIndex = (bar + note * 2) % 4;

        let midi = chord[chordIndex] + 12;

        if (config.photo === "pitch") {
          if (level > 0.66) {
            midi += 12;
          } else if (level < 0.33) {
            midi -= 12;
          }
        }

        notes.push({
          voice: "piano",
          time: time + offset,
          midi,

          // 수분 질량 비율 → 지속시간
          dur:
            BEAT *
            (
              config.water === "sustain"
                ? 0.35 + water * 1.3
                : 0.8
            ),

          vel: 0.42 + (note === 0 ? 0.12 : 0)
        });
      }


      /* 저음: 코드 안의 음을 사용 */

      const bassNotes = [
        chord[0] - 12,
        chord[0] - 12,
        chord[2] - 12,
        chord[(bar + 1) % 4] - 12
      ];

      for (let beat = 0; beat < 4; beat++) {
        notes.push({
          voice: "bass",
          time: time + beat * BEAT,
          midi: bassNotes[beat],
          dur: BEAT * 0.7,

          // 뿌리 건조중량 배분 비율 → 저음 상대 강도
          vel: 0.3 + root * 0.22
        });
      }


      /* 배경 화음 */

      notes.push({
        voice: "chord",
        time: time + 0.03,
        midis: chord.map(value => value + 12),

        dur:
          BAR *
          (
            config.water === "sustain"
              ? 0.3 + water * 0.55
              : 0.6
          ),

        vel: 0.13
      });


      /* 하이햇 */

      for (let hit = 0; hit < 8; hit++) {
        notes.push({
          voice: "hat",
          time:
            time +
            hit * BEAT / 2 +
            (hit % 2 ? 0.07 : 0),
          dur: 0.025,
          vel: hit % 2 ? 0.13 : 0.22
        });
      }


      /* 킥 */

      for (const beat of [0, 2]) {
        notes.push({
          voice: "kick",
          time: time + beat * BEAT,
          dur: 0.13,
          vel: 0.45
        });
      }


      /* 스네어 */

      for (const beat of [1, 3]) {
        notes.push({
          voice: "snare",
          time: time + beat * BEAT + 0.025,
          dur: 0.065,
          vel: 0.19
        });
      }
    }

    return {
      notes,
      frames,
      duration: DURATION,
      config: { ...config },
      version: "living-score-1.0"
    };
  }


  /* ── 피아노 샘플 준비 ──────────────── */

  async function preparePiano() {
    if (pianoBuffers) {
      return pianoBuffers;
    }

    const urls = {
      C3: "C3.mp3",
      C4: "C4.mp3",
      C5: "C5.mp3"
    };

    let timer;

    try {
      let local = false;

      try {
        const check = await fetch(
          "./assets/samples-ready.json"
        );

        local = check.ok;
      } catch {
        local = false;
      }

      const controller = new AbortController();

      timer = setTimeout(() => {
        controller.abort();
      }, 10000);

      const results = await Promise.all(
        Object.entries(urls).map(async ([note, filename]) => {
          const base = local
            ? "./assets/"
            : "https://tonejs.github.io/audio/salamander/";

          const response = await fetch(
            base + filename,
            { signal: controller.signal }
          );

          if (!response.ok) {
            throw new Error("Piano sample fetch failed");
          }

          const bytes = await response.arrayBuffer();

          const buffer =
            await Tone.getContext().rawContext.decodeAudioData(
              bytes
            );

          return [note, buffer];
        })
      );

      pianoBuffers = Object.fromEntries(results);
      samplerReady = true;
    } catch {
      // オンライン音源が使えない場合のローカル合成音源
      const results = await Promise.all(
        ["C3", "C4", "C5"].map(async note => {
          const response = await fetch(
            "./assets/" + note + ".wav"
          );

          if (!response.ok) {
            throw new Error("Local piano unavailable");
          }

          const bytes = await response.arrayBuffer();

          const buffer =
            await Tone.getContext().rawContext.decodeAudioData(
              bytes
            );

          return [note, buffer];
        })
      );

      pianoBuffers = Object.fromEntries(results);
      samplerReady = false;
    } finally {
      clearTimeout(timer);
    }

    return pianoBuffers;
  }


  /* ── 楽器とエフェクトの接続 ────────── */

  function graph(destination) {
    const master = new Tone.Gain(0.65)
      .connect(destination);

    const limit = new Tone.Limiter(-2)
      .connect(master);

    const rev = new Tone.Freeverb({
      roomSize: 0.55,
      dampening: 2800,
      wet: 0.13
    }).connect(limit);

    const filter = new Tone.Filter(
      2600,
      "lowpass"
    ).connect(rev);

    const pan = new Tone.Panner(0)
      .connect(filter);

    const piano = new Tone.Sampler({
      urls: pianoBuffers,
      attack: 0.003,
      release: 1.1
    }).connect(pan);

    const chord = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: "sine"
      },

      envelope: {
        attack: 0.07,
        decay: 0.3,
        sustain: 0.1,
        release: 1
      }
    }).connect(rev);

    // 실제 콘트라베이스 녹음이 아닌 합성 저음입니다.
    const bass = new Tone.MonoSynth({
      oscillator: {
        type: "triangle"
      },

      filter: {
        type: "lowpass",
        frequency: 800,
        Q: 0.6
      },

      envelope: {
        attack: 0.004,
        decay: 0.22,
        sustain: 0.05,
        release: 0.15
      },

      filterEnvelope: {
        attack: 0.003,
        decay: 0.18,
        sustain: 0,
        release: 0.1,
        baseFrequency: 100,
        octaves: 2.5
      }
    }).connect(limit);

    const hat = new Tone.NoiseSynth({
      noise: {
        type: "white"
      },

      envelope: {
        attack: 0.001,
        decay: 0.025,
        sustain: 0,
        release: 0.01
      }
    });

    const hp = new Tone.Filter(
      8000,
      "highpass"
    ).connect(limit);

    hat.connect(hp);

    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.025,
      octaves: 3,

      envelope: {
        attack: 0.001,
        decay: 0.12,
        sustain: 0,
        release: 0.02
      }
    }).connect(limit);

    const snare = new Tone.NoiseSynth({
      noise: {
        type: "pink"
      },

      envelope: {
        attack: 0.001,
        decay: 0.06,
        sustain: 0,
        release: 0.02
      }
    }).connect(limit);

    const nodes = {
      master,
      limit,
      rev,
      filter,
      pan,
      piano,
      chord,
      bass,
      hat,
      hp,
      kick,
      snare
    };

    return {
      ...nodes,

      dispose() {
        for (const node of Object.values(nodes)) {
          node.dispose();
        }
      }
    };
  }


  /* ── 악보를 오디오 시간에 예약 ─────── */

  function schedule(instruments, score, offset) {
    for (const frame of score.frames) {
      const time = offset + frame.time;

      instruments.filter.frequency.setValueAtTime(
        frame.cutoff * (0.65 + frame.timbre[0]),
        time
      );

      instruments.pan.pan.setValueAtTime(
        frame.pan,
        time
      );

      instruments.piano.volume.setValueAtTime(
        -3 + frame.timbre[1] * 5,
        time
      );

      instruments.chord.volume.setValueAtTime(
        -12 + frame.timbre[2] * 12,
        time
      );
    }

    for (const note of score.notes) {
      const time = offset + note.time;

      if (
        note.voice === "hat" ||
        note.voice === "snare"
      ) {
        instruments[note.voice].triggerAttackRelease(
          note.dur,
          time,
          note.vel
        );

        continue;
      }

      if (note.voice === "kick") {
        instruments.kick.triggerAttackRelease(
          "C1",
          note.dur,
          time,
          note.vel
        );

        continue;
      }

      const pitch = note.midis
        ? note.midis.map(midi =>
            Tone.Frequency(midi, "midi").toNote()
          )
        : Tone.Frequency(
            note.midi,
            "midi"
          ).toNote();

      instruments[note.voice].triggerAttackRelease(
        pitch,
        note.dur,
        time,
        note.vel
      );
    }
  }


  /* ── 실시간 재생·정지 ──────────────── */

  async function play(config) {
    await tone();
    await Tone.start();
    await preparePiano();

    stop();

    const score = build(config);

    live = graph(Tone.Destination);

    schedule(
      live,
      score,
      Tone.now() + 0.12
    );

    started = performance.now() + 120;

    return score;
  }

  function stop() {
    if (!live) return;

    live.master.gain.value = 0;
    live.dispose();
    live = null;
  }


  /* ── AudioBuffer → WAV ─────────────── */

  function wav(buffer) {
    const channels = buffer.numberOfChannels;
    const length = buffer.length;

    const arrayBuffer = new ArrayBuffer(
      44 + length * channels * 2
    );

    const view = new DataView(arrayBuffer);

    function writeText(offset, text) {
      for (let index = 0; index < text.length; index++) {
        view.setUint8(
          offset + index,
          text.charCodeAt(index)
        );
      }
    }

    writeText(0, "RIFF");

    view.setUint32(
      4,
      36 + length * channels * 2,
      true
    );

    writeText(8, "WAVE");
    writeText(12, "fmt ");

    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);

    view.setUint32(
      24,
      buffer.sampleRate,
      true
    );

    view.setUint32(
      28,
      buffer.sampleRate * channels * 2,
      true
    );

    view.setUint16(
      32,
      channels * 2,
      true
    );

    view.setUint16(34, 16, true);

    writeText(36, "data");

    view.setUint32(
      40,
      length * channels * 2,
      true
    );

    const audio = Array.from(
      { length: channels },
      (_, channel) => buffer.getChannelData(channel)
    );

    let offset = 44;

    for (let sample = 0; sample < length; sample++) {
      for (let channel = 0; channel < channels; channel++) {
        const value = Math.max(
          -1,
          Math.min(1, audio[channel][sample])
        );

        view.setInt16(
          offset,
          value < 0
            ? value * 32768
            : value * 32767,
          true
        );

        offset += 2;
      }
    }

    return new Blob(
      [arrayBuffer],
      { type: "audio/wav" }
    );
  }


  /* ── 다운로드용 오프라인 렌더링 ───── */

  async function render(config) {
    await tone();
    await Tone.start();
    await preparePiano();

    const score = build(config);

    const buffer = await Tone.Offline(() => {
      Tone.Destination.volume.value = -9;

      const instruments = graph(Tone.Destination);

      schedule(
        instruments,
        score,
        0.1
      );
    }, score.duration + 2, 2, 44100);

    return wav(buffer.get());
  }


  /* ── 다른 파일에서 사용하는 기능 ──── */

  return {
    build,
    play,
    stop,
    render,

    DURATION,
    norm,
    at,

    elapsed: () =>
      Math.max(
        0,
        (performance.now() - started) / 1000
      ),

    sampled: () => samplerReady
  };
})();
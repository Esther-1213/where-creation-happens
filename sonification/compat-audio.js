/*
 * Where Does Creation Happen?
 * 로컬 호환 오디오 엔진
 *
 * - Tone.js와 구분되는 별도 엔진입니다.
 * - 생성형 AI나 외부 서버를 사용하지 않습니다.
 * - ScoreEngine이 만든 악보를 연주합니다.
 * - PIANO_PCM의 합성 피아노 음원을 사용합니다.
 */

window.CompatAudio = (() => {
  "use strict";

  const SAMPLE_RATE = 22050;

  let context = null;
  let masterGain = null;
  let source = null;
  let started = 0;

  const cache = new Map();


  /* ── 사용자 클릭으로 오디오 활성화 ── */

  function unlock() {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error(
        "이 브라우저는 Web Audio를 지원하지 않습니다."
      );
    }

    if (!context) {
      context = new AudioContextClass();

      masterGain = context.createGain();
      masterGain.gain.value = 0.355;

      masterGain.connect(context.destination);
    }

    return context.resume();
  }


  /* ── 청취 음량 ─────────────────────── */

  function setVolume(decibels) {
    if (!masterGain) return;

    masterGain.gain.value = Math.pow(
      10,
      decibels / 20
    );
  }


  /* ── 악보 → 스테레오 PCM ───────────── */

  function render(score) {
    const key = JSON.stringify(score.config);

    if (cache.has(key)) {
      return cache.get(key);
    }

    if (!window.PIANO_PCM) {
      throw new Error(
        "piano-pcm.js를 먼저 불러와야 합니다."
      );
    }

    const size = Math.ceil(
      (score.duration + 2) * SAMPLE_RATE
    );

    const left = new Float32Array(size);
    const right = new Float32Array(size);

    // 같은 악보에서는 같은 타악기 파형을 만듭니다.
    let seed = 4917;

    function randomNoise() {
      seed = (
        Math.imul(seed, 1664525) + 1013904223
      ) >>> 0;

      return seed / 4294967296 * 2 - 1;
    }

    for (const note of score.notes) {
      const frameIndex = Math.min(
        score.frames.length - 1,
        Math.floor(
          note.time /
          (score.duration / score.frames.length)
        )
      );

      const frame = score.frames[frameIndex];

      const frequency = note.midi
        ? 440 * Math.pow(
            2,
            (note.midi - 69) / 12
          )
        : 0;

      const start = Math.floor(
        note.time * SAMPLE_RATE
      );

      let tail;

      if (note.voice === "piano") {
        tail = Math.min(3, note.dur + 1.1);
      } else if (note.voice === "chord") {
        tail = note.dur + 1;
      } else if (note.voice === "bass") {
        tail = note.dur + 0.15;
      } else if (note.voice === "hat") {
        tail = 0.09;
      } else if (note.voice === "kick") {
        tail = 0.25;
      } else {
        tail = 0.18;
      }

      const sampleCount = Math.min(
        Math.ceil(tail * SAMPLE_RATE),
        size - start
      );

      const pan = note.voice === "piano"
        ? frame.pan
        : 0;

      const leftGain = Math.cos(
        (pan + 1) * Math.PI / 4
      );

      const rightGain = Math.sin(
        (pan + 1) * Math.PI / 4
      );

      let lowpass = 0;

      const alpha = 1 - Math.exp(
        -2 *
        Math.PI *
        frame.cutoff *
        (0.65 + frame.timbre[0]) /
        SAMPLE_RATE
      );

      let sample = null;
      let playbackRate = 1;

      if (note.voice === "piano") {
        const root = [48, 60, 72].reduce(
          (closest, candidate) =>
            Math.abs(note.midi - closest) <
            Math.abs(note.midi - candidate)
              ? closest
              : candidate
        );

        sample = window.PIANO_PCM[root];

        playbackRate = Math.pow(
          2,
          (note.midi - root) / 12
        );
      }


      /* 각 악기의 파형 생성 */

      for (let index = 0; index < sampleCount; index++) {
        const time = index / SAMPLE_RATE;

        let value = 0;


        /* 합성 피아노 샘플 */

        if (note.voice === "piano") {
          const position = index * playbackRate;
          const sampleIndex = Math.floor(position);
          const fraction = position - sampleIndex;

          if (sampleIndex + 1 < sample.length) {
            value =
              sample[sampleIndex] * (1 - fraction) +
              sample[sampleIndex + 1] * fraction;
          }

          // 음을 놓은 뒤 서서히 감쇠합니다.
          value *= Math.exp(
            -5 * Math.max(0, time - note.dur)
          );

          // 데이터에 따른 로우패스 필터입니다.
          lowpass += alpha * (value - lowpass);

          value =
            lowpass *
            0.65 *
            (0.85 + frame.timbre[1]);
        }


        /* 뜯는 질감의 합성 저음 */

        else if (note.voice === "bass") {
          const fundamental = Math.sin(
            2 * Math.PI * frequency * time
          );

          const second = 0.35 * Math.sin(
            4 * Math.PI * frequency * time
          );

          const third = 0.12 * Math.sin(
            6 * Math.PI * frequency * time
          );

          const attack = Math.min(
            1,
            time / 0.003
          );

          const decay =
            Math.exp(-time * 8) + 0.035;

          const release = Math.exp(
            -20 * Math.max(0, time - note.dur)
          );

          value =
            (fundamental + second + third) *
            attack *
            decay *
            release *
            0.5;
        }


        /* 배경 화음 */

        else if (note.voice === "chord") {
          for (const midi of note.midis) {
            const chordFrequency =
              440 * Math.pow(
                2,
                (midi - 69) / 12
              );

            value += Math.sin(
              2 * Math.PI * chordFrequency * time
            );
          }

          const attack = Math.min(
            1,
            time / 0.05
          );

          const decay = Math.exp(-time * 1.5);

          const release = Math.exp(
            -6 * Math.max(0, time - note.dur)
          );

          value *=
            attack *
            decay *
            release *
            0.14 *
            (0.6 + frame.timbre[2]);
        }


        /* 가벼운 노이즈 하이햇 */

        else if (note.voice === "hat") {
          value =
            randomNoise() *
            Math.exp(-time * 80) *
            0.18;
        }


        /* 노이즈와 몸통음을 섞은 스네어 */

        else if (note.voice === "snare") {
          const noise = randomNoise() * 0.65;

          const body =
            Math.sin(
              2 * Math.PI * 180 * time
            ) * 0.2;

          value =
            (noise + body) *
            Math.exp(-time * 35) *
            0.28;
        }


        /* 내려가는 피치의 킥 */

        else if (note.voice === "kick") {
          const phase =
            2 *
            Math.PI *
            (
              48 * time +
              3 * (1 - Math.exp(-time * 35))
            );

          value =
            Math.sin(phase) *
            Math.exp(-time * 20) *
            0.75;
        }


        /* 스테레오 믹싱 */

        value *= note.vel;

        left[start + index] += value * leftGain;
        right[start + index] += value * rightGain;
      }
    }


    /* 짧은 공간감과 소프트 리미팅 */

    const delay = Math.floor(
      SAMPLE_RATE * 0.14
    );

    for (let index = 0; index < size; index++) {
      if (index > delay) {
        left[index] +=
          right[index - delay] * 0.08;

        right[index] +=
          left[index - delay] * 0.08;
      }

      left[index] =
        Math.tanh(left[index] * 1.8) * 0.7;

      right[index] =
        Math.tanh(right[index] * 1.8) * 0.7;
    }

    const result = {
      left,
      right,
      sampleRate: SAMPLE_RATE,
      duration: size / SAMPLE_RATE
    };

    cache.set(key, result);

    // 메모리 사용을 줄이기 위해 최근 세 곡만 보관합니다.
    if (cache.size > 3) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }

    return result;
  }


  /* ── 정지 ──────────────────────────── */

  function stop() {
    if (!source) return;

    try {
      source.stop();
    } catch {
      // 이미 끝난 소스일 수 있습니다.
    }

    source.disconnect();
    source = null;
  }


  /* ── 재생 ──────────────────────────── */

  async function play(score) {
    await unlock();

    const pcm = render(score);

    stop();

    const buffer = context.createBuffer(
      2,
      pcm.left.length,
      SAMPLE_RATE
    );

    buffer.copyToChannel(pcm.left, 0);
    buffer.copyToChannel(pcm.right, 1);

    source = context.createBufferSource();
    source.buffer = buffer;

    source.connect(masterGain);
    source.start();

    started = performance.now();

    return score;
  }


  /* ── 다운로드용 WAV 만들기 ────────── */

  function wav(score) {
    const pcm = render(score);
    const length = pcm.left.length;

    const arrayBuffer = new ArrayBuffer(
      44 + length * 4
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
    view.setUint32(4, 36 + length * 4, true);

    writeText(8, "WAVE");
    writeText(12, "fmt ");

    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);

    writeText(36, "data");
    view.setUint32(40, length * 4, true);

    for (let index = 0; index < length; index++) {
      const left = Math.max(
        -1,
        Math.min(1, pcm.left[index])
      );

      const right = Math.max(
        -1,
        Math.min(1, pcm.right[index])
      );

      view.setInt16(
        44 + index * 4,
        left * 32767,
        true
      );

      view.setInt16(
        46 + index * 4,
        right * 32767,
        true
      );
    }

    return new Blob(
      [arrayBuffer],
      { type: "audio/wav" }
    );
  }


  /* ── 다른 파일에서 사용하는 기능 ──── */

  return {
    unlock,
    play,
    stop,
    render,
    wav,
    setVolume,

    elapsed: () =>
      Math.max(
        0,
        (performance.now() - started) / 1000
      )
  };
})();
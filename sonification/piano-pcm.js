/*
 * Where Does Creation Happen?
 * 로컬 호환 재생용 합성 피아노 음원
 *
 * - 외부 라이브러리나 다운로드 없이 생성합니다.
 * - 생성형 AI를 사용하지 않습니다.
 * - 실제 그랜드피아노 녹음이 아닌 수학적 합성 음원입니다.
 *
 * compat-audio.js에서 사용하는 형식:
 *
 * window.PIANO_PCM = {
 *   48: Float32Array,  // C3
 *   60: Float32Array,  // C4
 *   72: Float32Array   // C5
 * };
 */

(() => {
  "use strict";

  const SAMPLE_RATE = 22050;
  const DURATION = 4;
  const HARMONICS = 14;

  const SAMPLE_COUNT = Math.floor(
    SAMPLE_RATE * DURATION
  );

  const SOURCES = [
    { midi: 48, frequency: 130.8128 },
    { midi: 60, frequency: 261.6256 },
    { midi: 72, frequency: 523.2511 }
  ];

  function createPianoSample(frequency) {
    const samples = new Float32Array(SAMPLE_COUNT);

    let peak = 0;

    for (let index = 0; index < SAMPLE_COUNT; index++) {
      const time = index / SAMPLE_RATE;

      let value = 0;

      for (
        let harmonic = 1;
        harmonic <= HARMONICS;
        harmonic++
      ) {
        /*
         * 배음의 주파수를 조금씩 벌려
         * 이상적인 사인파와 다른 질감을 만듭니다.
         */

        const stretch =
          1 + 0.00012 * harmonic * harmonic;

        const harmonicFrequency =
          frequency * harmonic * stretch;

        // 높은 배음이 더 빨리 사라지도록 설정합니다.
        const decay = Math.exp(
          -time * (1.1 + harmonic * 0.22)
        );

        const strength =
          1 / Math.pow(harmonic, 1.7);

        value +=
          Math.sin(
            2 * Math.PI * harmonicFrequency * time
          ) *
          decay *
          strength;
      }

      // 시작 부분의 클릭을 줄이는 짧은 어택입니다.
      const attack = Math.min(
        time / 0.004,
        1
      );

      const bodyDecay = Math.exp(
        -time * 0.25
      );

      value *= attack * bodyDecay;

      samples[index] = value;

      peak = Math.max(
        peak,
        Math.abs(value)
      );
    }

    /*
     * 최대 진폭을 0.65로 맞추고,
     * 기존 로컬 WAV와 같은 16비트 정밀도로 양자화합니다.
     */

    if (peak > 0) {
      const gain = 0.65 / peak;

      for (let index = 0; index < samples.length; index++) {
        const value = samples[index] * gain;

        samples[index] =
          Math.trunc(value * 32767) / 32768;
      }
    }

    return samples;
  }

  const piano = {};

  for (const source of SOURCES) {
    piano[source.midi] = createPianoSample(
      source.frequency
    );
  }

  window.PIANO_PCM = piano;
})();
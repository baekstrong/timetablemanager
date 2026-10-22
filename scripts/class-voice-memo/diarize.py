"""수업 녹음 화자 구분 — 받아쓰기 줄 단위 (sherpa-onnx 목소리 특징값 + 계층 군집, 이 Mac에서만 처리).

    ~/.local/share/class-voice-memo/venv/bin/python diarize.py <16kHz 모노 wav> <줄 목록 json> [임계값]

줄 목록 json: [{"start": 초, "end": 초}, ...] (whisper SRT 줄)
표준출력: {"speakers": [줄마다 화자번호 또는 null], "embeddings": {"화자번호": [실수...]}, "threshold": 값}

- 처음엔 sherpa-onnx의 pyannote 화자 구분을 썼지만 86분 녹음이 713명으로 쪼개지고 재실행마다 9분이라 조정이 불가능했다.
  whisper가 이미 말 단위로 자른 줄마다 특징값을 계산해 묶으면 글 줄과 정확히 맞고, 임계값 조정은 몇 초면 된다.
- 화자 번호는 "같은 목소리끼리 묶은 것"일 뿐 누구인지는 모른다. 코치 판단·이름 매칭은 lib.mjs 몫.
- embeddings(화자별 평균 특징값)는 성문 비교용 생체정보 → pipeline이 이 Mac의 voiceprints.json(600)에만 저장.
"""
import json
import os
import sys
import wave

import numpy as np
import sherpa_onnx
from scipy.cluster.hierarchy import fcluster, linkage

MODEL = os.path.expanduser('~/.local/share/class-voice-memo/models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx')
SR = 16000
MIN_SEC = 0.8  # 이보다 짧은 줄("네", "응")은 특징값이 불안정 → 화자 없음(null)으로 두고 앞뒤 맥락에 맡긴다


def read_wav(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1, '16kHz 모노 wav만'
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def embed_lines(samples, lines):
    ex = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=MODEL, num_threads=8))
    idx, embs = [], []
    for i, l in enumerate(lines):
        if l['end'] - l['start'] < MIN_SEC:
            continue
        st = ex.create_stream()
        st.accept_waveform(SR, samples[int(l['start'] * SR):int(l['end'] * SR)])
        st.input_finished()
        e = np.array(ex.compute(st))
        embs.append(e / (np.linalg.norm(e) or 1))
        idx.append(i)
    return idx, np.array(embs)


def cluster(embs, threshold):
    # 평균 연결 + 코사인 거리. 임계값이 클수록 더 많이 합쳐진다(화자 수 감소).
    return fcluster(linkage(embs, method='average', metric='cosine'), t=threshold, criterion='distance')


def main(wav, lines_path, threshold=0.6):
    samples = read_wav(wav)
    with open(lines_path) as f:
        lines = json.load(f)
    idx, embs = embed_lines(samples, lines)
    speakers = [None] * len(lines)
    out_emb = {}
    if len(idx) >= 2:
        labels = cluster(embs, threshold)
        for i, lab in zip(idx, labels):
            speakers[i] = int(lab)
        for lab in set(labels):
            mean = embs[labels == lab].mean(axis=0)
            if (labels == lab).sum() >= 3:  # 몇 줄 안 되는 목소리는 성문으로 믿기 어렵다
                out_emb[str(int(lab))] = (mean / np.linalg.norm(mean)).round(5).tolist()
    json.dump({'speakers': speakers, 'embeddings': out_emb, 'threshold': threshold}, sys.stdout)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 0.6)

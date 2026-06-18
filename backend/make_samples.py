"""테스트용 MIDI 3종 생성 (ADR 0008 / 계획 '테스트용 MID 구하는 방법').

- melody.mid : 단성 → '기타'
- canon.mid  : 같은 선율을 2박 늦춰 모방 → '캐논'
- bwv66.mid  : 바흐 코랄(다성/화음) → '화음'  (music21 코퍼스)
"""
import os

from music21 import converter, corpus, stream, note

OUT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "samples")
os.makedirs(OUT, exist_ok=True)


def make_melody():
    s = converter.parse("tinynotation: 4/4 c4 d e f g a g f e d c2 e4 g c'2")
    s.write("midi", os.path.join(OUT, "melody.mid"))


def make_canon():
    theme = "c4 e g e f a g e d f e c d g e c"
    lead = converter.parse(f"tinynotation: 4/4 {theme}").flatten().notes.stream()
    follow_src = converter.parse(f"tinynotation: 4/4 {theme}").flatten().notes.stream()

    score = stream.Score()
    p1 = stream.Part()
    for n in lead:
        p1.append(note.Note(n.pitch, quarterLength=n.quarterLength))
    p2 = stream.Part()
    p2.insert(0, note.Rest(quarterLength=2.0))  # 2박 지연 모방
    for n in follow_src:
        # 5도 위 이조(이조 허용 캐논 테스트)
        nn = note.Note(n.pitch.transpose(7), quarterLength=n.quarterLength)
        p2.append(nn)
    score.insert(0, p1)
    score.insert(0, p2)
    score.write("midi", os.path.join(OUT, "canon.mid"))


def make_bwv66():
    b = corpus.parse("bach/bwv66.6")
    b.write("midi", os.path.join(OUT, "bwv66.mid"))


if __name__ == "__main__":
    make_melody()
    make_canon()
    make_bwv66()
    print("samples written to", OUT)

from app.core.sparse_encoder import BGEM3SparseEncoder


class _ModernBgeModel:
    """Represents current FlagEmbedding, which exposes only ``encode``."""

    def __init__(self):
        self.calls = []

    def encode(self, sentences, **kwargs):
        self.calls.append({"sentences": list(sentences), **kwargs})
        return {
            "lexical_weights": [
                {"101": 0.8, "202": 0.3}
                for _ in sentences
            ]
        }


def _encoder_with(model):
    encoder = BGEM3SparseEncoder.__new__(BGEM3SparseEncoder)
    encoder._model = model
    encoder._initialized = True
    return encoder


def test_sparse_query_encoding_supports_current_bge_m3_encode_api():
    model = _ModernBgeModel()

    result = _encoder_with(model).encode_query("阿凡达取景地")

    assert result["sparse"] == {101: 0.8, 202: 0.3}
    assert model.calls[0]["sentences"] == ["阿凡达取景地"]
    assert model.calls[0]["return_sparse"] is True


def test_sparse_corpus_encoding_supports_current_bge_m3_encode_api():
    model = _ModernBgeModel()

    results = _encoder_with(model).encode_corpus(["第一段", "第二段"], batch_size=8)

    assert results == [
        {"sparse": {101: 0.8, 202: 0.3}},
        {"sparse": {101: 0.8, 202: 0.3}},
    ]
    assert model.calls[0]["batch_size"] == 8


def test_shared_query_and_corpus_inference_are_serialized_without_initializer_deadlock():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    import time

    class ConcurrentModel(_ModernBgeModel):
        def __init__(self):
            super().__init__()
            self.active = self.maximum = 0
            self.lock = Lock()

        def encode(self, sentences, **kwargs):
            with self.lock:
                self.active += 1
                self.maximum = max(self.maximum, self.active)
            try:
                time.sleep(.01)
                return super().encode(sentences, **kwargs)
            finally:
                with self.lock:
                    self.active -= 1

    model, ready = ConcurrentModel(), Barrier(2)
    encoder = _encoder_with(model)
    def query():
        ready.wait()
        return encoder.encode_query("query")
    def corpus():
        ready.wait()
        return encoder.encode_corpus(["source"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(query), pool.submit(corpus)
        assert a.result(timeout=2) == {"sparse": {101: .8, 202: .3}}
        assert b.result(timeout=2) == [{"sparse": {101: .8, 202: .3}}]
    assert model.maximum == 1

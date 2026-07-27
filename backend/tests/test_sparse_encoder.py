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

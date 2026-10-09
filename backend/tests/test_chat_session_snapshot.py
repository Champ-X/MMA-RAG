import json

import pytest

from app.modules.chat.session_snapshot import restore_session_snapshot


def snapshot(tmp_path, rows):
    path = tmp_path / 'history.json'
    path.write_text(json.dumps({'version': 1, 'sessions': rows}))
    return str(path)


def session(identity='session'):
    return {'id': identity, 'title': '旧会话', 'created_at': '2026-10-09', 'messages': [
        {'role': 'user', 'content': '问题'},
        {'role': 'assistant', 'content': '回答 [1]', 'citations': [{'id': 1}],
         'diagnostics': {'retrieval': {'runs': []}}},
    ]}


def test_explicit_restore_preserves_history_citations_and_receipts(tmp_path):
    original = session()
    restored = {}
    assert restore_session_snapshot(restored, snapshot(tmp_path, [original])) == (1, 2)
    assert restored == {'session': original}


@pytest.mark.parametrize('row', [None, {'id': 'broken'}, {'id': 'bad', 'messages': [None]},
    {'id': 'bad', 'messages': [{'role': 'system', 'content': 'invalid'}]}, session()])
def test_validation_failure_never_partially_restores(tmp_path, row):
    restored = {}
    with pytest.raises(ValueError):
        restore_session_snapshot(restored, snapshot(tmp_path, [session(), row]))
    assert restored == {}


def test_cannot_replace_an_active_session_store(tmp_path):
    current = {'existing': session('existing')}
    with pytest.raises(ValueError, match='empty'):
        restore_session_snapshot(current, snapshot(tmp_path, [session()]))
    assert list(current) == ['existing']

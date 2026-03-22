from app.integrations.feishu_parser import extract_message_resource_spec


def test_extract_image_resource():
    spec = extract_message_resource_spec(
        "image", '{"image_key": "img_v2_abc"}'
    )
    assert spec == ("image", "img_v2_abc", ".jpg")


def test_extract_audio_resource():
    spec = extract_message_resource_spec(
        "audio", '{"file_key": "file_v2_xyz"}'
    )
    assert spec == ("file", "file_v2_xyz", ".mp3")


def test_extract_none_for_text():
    assert extract_message_resource_spec("text", '{"text":"hi"}') is None

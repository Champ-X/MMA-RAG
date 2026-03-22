from app.integrations.feishu_parser import extract_message_resource_spec


def test_extract_image_resource():
    spec = extract_message_resource_spec(
        "image", '{"image_key": "img_v2_abc"}'
    )
    assert spec == ("image", "img_v2_abc", ".jpg", None)


def test_extract_audio_resource():
    spec = extract_message_resource_spec(
        "audio", '{"file_key": "file_v2_xyz"}'
    )
    assert spec == ("file", "file_v2_xyz", ".mp3", None)


def test_extract_file_mp3_resource():
    spec = extract_message_resource_spec(
        "file",
        '{"file_key": "file_v2_abc", "file_name": "ZiZhuDiao.mp3"}',
    )
    assert spec == ("file", "file_v2_abc", ".mp3", "ZiZhuDiao.mp3")


def test_extract_file_pdf_rejected():
    assert (
        extract_message_resource_spec(
            "file",
            '{"file_key": "file_v2_x", "file_name": "a.pdf"}',
        )
        is None
    )


def test_extract_none_for_text():
    assert extract_message_resource_spec("text", '{"text":"hi"}') is None

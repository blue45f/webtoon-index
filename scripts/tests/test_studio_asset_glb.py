"""Synthetic structural tests; no rendering or artistic approval implied."""
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import normalize_studio_asset_glb as n

COLOR_IMAGE = 'color.png'


class GlbTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.glb'
        self.out = self.root / 'result.glb'
        self.texture = b'\x89PNG\r\n\x1a\nsynthetic-signature-only'
        (self.root / COLOR_IMAGE).write_bytes(self.texture)
        self.doc = {'asset': {'version': '2.0'}, 'buffers': [{'byteLength': 4}],
                    'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 4}],
                    'images': [{'uri': COLOR_IMAGE}], 'nodes': [], 'meshes': []}
        self.save()

    def save(self):
        self.source.write_bytes(n.write_glb(self.doc, b'1234'))

    def test_external_image_embedded_without_geometry_change(self):
        report = n.normalize(self.source, self.out)
        doc, data = n.read_glb(self.out.read_bytes())
        self.assertEqual(data[:4], b'1234')
        self.assertNotIn('uri', doc['images'][0])
        view = doc['bufferViews'][doc['images'][0]['bufferView']]
        self.assertEqual(data[view['byteOffset']:view['byteOffset'] + view['byteLength']], self.texture)
        self.assertTrue(report['geometryBytesPreserved'])
        self.assertFalse(report['studioRuntimeVerified'])

    def test_already_embedded_is_byte_identical(self):
        n.normalize(self.source, self.out)
        other = self.root / 'second.glb'
        n.normalize(self.out, other)
        self.assertEqual(self.out.read_bytes(), other.read_bytes())

    def test_invalid_header_and_lengths(self):
        for data in [b'bad', b'nope' + self.source.read_bytes()[4:], self.source.read_bytes()[:-1]]:
            with self.subTest(data=data[:8]), self.assertRaises(ValueError):
                n.read_glb(data)

    def test_external_and_traversal_uris_rejected(self):
        for uri in ['../color.png', '/etc/passwd', 'https://example.org/a.png', 'data:image/png;base64,AAAA', '%2e%2e/color.png']:
            with self.subTest(uri=uri):
                self.doc['images'][0]['uri'] = uri
                self.save()
                with self.assertRaises((ValueError, OSError)):
                    n.normalize(self.source, self.out)
                self.assertFalse(self.out.exists())

    def test_texture_symlink_rejected(self):
        (self.root / 'link.png').symlink_to(self.root / COLOR_IMAGE)
        self.doc['images'][0]['uri'] = 'link.png'
        self.save()
        with self.assertRaises(ValueError):
            n.normalize(self.source, self.out)

    def test_font_or_unknown_image_signature_rejected(self):
        (self.root / COLOR_IMAGE).write_bytes(b'not-an-image')
        with self.assertRaises(ValueError):
            n.normalize(self.source, self.out)

    def test_existing_destination_never_overwritten(self):
        self.out.write_bytes(b'keep')
        with self.assertRaises(ValueError):
            n.normalize(self.source, self.out)
        self.assertEqual(self.out.read_bytes(), b'keep')

    def test_buffer_view_outside_binary_rejected(self):
        self.doc['bufferViews'][0]['byteLength'] = 99
        self.save()
        with self.assertRaises(ValueError):
            n.normalize(self.source, self.out)


if __name__ == '__main__':
    unittest.main()

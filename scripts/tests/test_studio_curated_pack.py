"""Synthetic structural tests; rendered source models are a separate review artifact."""
from pathlib import Path
import json
import struct
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pack_studio_curated_gltf import pack

A_IMAGE = 'a.png'


class PackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'model.gltf'
        self.output = self.root / 'model.glb'
        self.image = b'\x89PNG\r\n\x1a\nsynthetic-image-signature-only'
        (self.root / 'a.bin').write_bytes(b'1234')
        (self.root / A_IMAGE).write_bytes(self.image)
        self.doc = {'asset': {'version': '2.0'}, 'buffers': [{'uri': 'a.bin', 'byteLength': 4}], 'bufferViews': [{'buffer': 0, 'byteLength': 4}], 'images': [{'uri': A_IMAGE}], 'nodes': [], 'meshes': [], 'materials': [{'doubleSided': True}]}
        self.save()

    def save(self):
        self.source.write_text(json.dumps(self.doc))

    def test_preserves_geometry_materials_and_embeds_original_texture(self):
        report = pack(self.source, self.output)
        data = self.output.read_bytes()
        _, version, size = struct.unpack_from('<4sII', data)
        js_len = struct.unpack_from('<I', data, 12)[0]
        doc = json.loads(data[20:20+js_len])
        binary = data[28+js_len:]
        self.assertEqual(version, 2)
        self.assertEqual(size, len(data))
        self.assertEqual(binary[:4], b'1234')
        self.assertEqual(doc['materials'], self.doc['materials'])
        self.assertNotIn('uri', doc['buffers'][0])
        self.assertNotIn('uri', doc['images'][0])
        view = doc['bufferViews'][doc['images'][0]['bufferView']]
        self.assertEqual(binary[view['byteOffset']:view['byteOffset']+view['byteLength']], self.image)
        self.assertTrue(report['geometryBytesPreserved'])

    def test_deduplicates_identical_images_inside_one_glb(self):
        self.doc['images'].append({'uri': A_IMAGE})
        self.save()
        pack(self.source, self.output)
        raw = self.output.read_bytes(); n = struct.unpack_from('<I', raw, 12)[0]
        doc = json.loads(raw[20:20+n])
        self.assertEqual(doc['images'][0]['bufferView'], doc['images'][1]['bufferView'])

    def test_remote_traversal_and_fonts_rejected(self):
        for uri in ['https://example.org/a.png', '../a.png', '%2e%2e/a.png', '/etc/passwd', 'data:image/png,AAAA', 'a.woff2']:
            with self.subTest(uri=uri):
                self.doc['images'][0]['uri'] = uri; self.save()
                with self.assertRaises((ValueError, OSError)):
                    pack(self.source, self.output)

    def test_symlink_rejected(self):
        (self.root / 'link.png').symlink_to(self.root / A_IMAGE)
        self.doc['images'][0]['uri'] = 'link.png'; self.save()
        with self.assertRaises(ValueError): pack(self.source, self.output)

    def test_buffer_length_and_view_bounds(self):
        self.doc['buffers'][0]['byteLength'] = 7; self.save()
        with self.assertRaises(ValueError): pack(self.source, self.output)
        self.doc['buffers'][0]['byteLength'] = 4
        self.doc['bufferViews'][0]['byteLength'] = 8; self.save()
        with self.assertRaises(ValueError): pack(self.source, self.output)

    def test_existing_file_never_overwritten(self):
        self.output.write_text('keep')
        with self.assertRaises(ValueError): pack(self.source, self.output)
        self.assertEqual(self.output.read_text(), 'keep')

    def test_ambiguous_embedded_and_external_image_rejected(self):
        self.doc['images'][0]['bufferView'] = 0; self.save()
        with self.assertRaises(ValueError): pack(self.source, self.output)


if __name__ == '__main__': unittest.main()

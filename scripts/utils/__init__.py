import io
import re


def barcode_svg(value, height=15, show_text=False):
	"""Generate an inline SVG barcode for the given value using CODE128."""
	if not value:
		return ""
	try:
		import barcode
		from barcode.writer import SVGWriter

		writer = SVGWriter()
		bc = barcode.get("code128", str(value), writer=writer)
		options = {
			"write_text": show_text,
			"module_height": height,
			"quiet_zone": 2,
		}
		buf = io.BytesIO()
		bc.write(buf, options=options)
		svg = buf.getvalue().decode("utf-8")
		start = svg.find("<svg")
		svg = svg[start:] if start != -1 else svg
		# Keep original mm dimensions so CSS can center the element
		return svg
	except Exception:
		return ""

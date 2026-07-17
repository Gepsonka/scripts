# Copyright (c) 2026, asd
# For license information, please see license.txt

import frappe


PAD_LENGTH = 6
"""Number of digits in the auto-generated item code."""


def get_next_item_code() -> str:
	"""Return the next available 6-digit zero-padded item code.

	Scans all existing Item names for codes matching the pattern
	(any length of digits, zero-padded or not) and returns the
	highest numeric value + 1, zero-padded to ``PAD_LENGTH`` digits.

	Example:
		if the highest existing numeric code is ``000042`` → returns ``000043``.
		if no numeric codes exist → returns ``000001``.
	"""
	max_num = 0

	for row in frappe.db.sql(
		"SELECT `name` FROM `tabItem` WHERE `name` REGEXP '^[0-9]+$'",
		as_dict=True,
	):
		try:
			num = int(row["name"])
			if num > max_num:
				max_num = num
		except (ValueError, TypeError):
			continue

	return str(max_num + 1).zfill(PAD_LENGTH)

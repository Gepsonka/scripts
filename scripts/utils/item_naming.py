# Copyright (c) 2026, asd
# For license information, please see license.txt

import frappe

PAD_LENGTH = 6
"""Number of digits in the auto-generated item code."""


def get_next_item_code() -> str:
	"""Return the next available 6-digit zero-padded item code.

	Uses a ``SELECT … FOR UPDATE`` row-level lock within Frappe's
	transaction to guarantee that two concurrent inserts cannot both
	claim the same number.

	Example:
		if ``000042`` is the highest numeric code → returns ``000043``.
		if no numeric codes exist → returns ``000001``.
	"""
	result = frappe.db.sql(
		"""
		SELECT MAX(CAST(`name` AS UNSIGNED))
		FROM `tabItem`
		WHERE `name` REGEXP '^[0-9]+$'
		FOR UPDATE
		""",
		as_list=True,
	)
	max_num = (result[0][0] or 0) if result else 0
	max_num = int(max_num)
	return str(max_num + 1).zfill(PAD_LENGTH)

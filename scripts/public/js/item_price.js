/**
 * Item Price – allow selecting template items (has_variants = 1).
 *
 * ERPNext v15+ filters out template items in the item_code link field
 * (has_variants: 0). This override removes that filter so you can set
 * prices on template items, which variants will then inherit.
 */
frappe.ui.form.on("Item Price", {
	setup: function (frm) {
		// Remove the has_variants: 0 filter that blocks template items.
		frm.set_query("item_code", function () {
			return {};
		});
	},
});

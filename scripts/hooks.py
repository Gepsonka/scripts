app_name = "scripts"
app_title = "Scripts"
app_publisher = "asd"
app_description = "scripts"
app_email = "asd@asd.asd"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "scripts",
# 		"logo": "/assets/scripts/logo.png",
# 		"title": "Scripts",
# 		"route": "/scripts",
# 		"has_permission": "scripts.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/scripts/css/scripts.css"
#
# We deliberately do NOT pin a hardcoded `?v=...` cache buster here.
# A pinned version would silently keep browsers on the old file
# whenever the JS source changes until the string is bumped by hand,
# which is the most common reason "the new button is in the image but
# does not show up in production" - the browser keeps loading the
# old, pre-deploy cached copy.
#
# Instead, the Dockerfile (apps/scripts/docker/Dockerfile) `touch`es
# every file under apps/scripts/scripts/public/ to the image build
# time. Nginx then serves those files with a current `Last-Modified`
# header, so browsers refetch automatically on the next page load
# after a deploy (standard `If-Modified-Since` / 304 behaviour).
app_include_js = [
	"/assets/scripts/js/qz_utils.js",
	"/assets/scripts/js/bin_list.js",
]

# include js in doctype views

# include js, css files in header of web template
# web_include_css = "/assets/scripts/css/scripts.css"
# web_include_js = "/assets/scripts/js/scripts.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "scripts/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Item": "public/js/item.js",
	"Stock Entry": "public/js/stock_entry.js",
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "scripts/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
jinja = {
	"methods": ["scripts.utils.barcode_svg"]
}

# Installation
# ------------

# before_install = "scripts.install.before_install"
# after_install = "scripts.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "scripts.uninstall.before_uninstall"
# after_uninstall = "scripts.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "scripts.utils.before_app_install"
# after_app_install = "scripts.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "scripts.utils.before_app_uninstall"
# after_app_uninstall = "scripts.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "scripts.notifications.get_notification_config"

# Fixtures
# --------
fixtures = [
	{
		"doctype": "Client Script",
		"filters": [[
			"dt", "in", [
				"Item",
				"Item Price",
				"BOM",
				"Sales Order",
				"Sales Order Item",
				"Project",
				"Work Order",
				"Work Order Item",
			]
		]],
	},
	{
		"doctype": "Custom Field",
		"filters": [
			["dt", "in", [
				"Item",
				"Item Price",
				"Sales Order",
				"Sales Order Item",
				"Purchase Receipt",
				"Purchase Receipt Item",
			]],
		],
	},
	{
		"doctype": "Property Setter",
		"filters": [
			["doc_type", "in", ["Item", "Item Price"]],
		],
	},
]

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	# "Batch": {
	# 	"after_insert": "scripts.scripts.fabric_length_propagation.propagate_fabric_length"
	# },
	"Purchase Receipt": {
		"on_submit": "scripts.scripts.fabric_length_propagation_pr.propagate_fabric_length",
		"on_cancel": "scripts.utils.pr_cancel_reset_barcode.reset_printed_qty_on_cancel",
	},
	# "Sales Order": {
	# 	"on_submit": "scripts.scripts.propagate_chosen_fabric.propagate_chosen_fabric"
	# },
	"Sales Order": {
		# Item-defaults population (item_name / stock_uom / uom /
		# conversion_factor on each row) used to live on a SalesOrder
		# subclass in scripts.doctype.sales_order. It is now a doc_event.
		"validate": "scripts.utils.so_validate.populate_item_defaults",
	},
	"Work Order": {
		"on_submit": "scripts.scripts.work_order_scripts.main_scripts.on_submit",
		"before_save": "scripts.scripts.work_order_scripts.main_scripts.on_save",
		"before_validate": "scripts.scripts.work_order_scripts.main_scripts.before_validate",
		# set_required_items / set_work_order_operations used to live on a
		# WorkOrder subclass in scripts.doctype.work_order. They are now
		# wired as a single validate handler.
		"validate": "scripts.utils.wo_overrides.work_order_validate",
	},
	"Item": {
	},
	"BOM": {
		# Custom naming (BOM-{item}-{finishing}-{hash} for Products group
		# items) used to live on a BOM subclass in scripts.doctype.bom.
		# It is now a before_naming doc_event.
		"before_naming": "scripts.utils.bom_autoname.bom_autoname",
	},
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"scripts.tasks.all"
# 	],
# 	"daily": [
# 		"scripts.tasks.daily"
# 	],
# 	"hourly": [
# 		"scripts.tasks.hourly"
# 	],
# 	"weekly": [
# 		"scripts.tasks.weekly"
# 	],
# 	"monthly": [
# 		"scripts.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "scripts.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "scripts.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "scripts.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["scripts.utils.before_request"]
# after_request = ["scripts.utils.after_request"]

# Job Events
# ----------
# before_job = ["scripts.utils.before_job"]
# after_job = ["scripts.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"scripts.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }


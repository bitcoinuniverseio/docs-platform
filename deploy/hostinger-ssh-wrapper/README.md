# Docs SSH wrapper prototype — do not install

This is a deny-only prototype. It classifies the checked-in deploy and rollback
heredocs with a fixed releases path, retention of five, and a bounded SHA (or
empty rollback target), but **rejects every operation**. It does not support
SFTP, legacy SCP, extraction, release switching, rollback, or curl. Installing
it would break the existing workflow. The templates are pinned copies of the
expanded heredocs in the current repository; changes to those scripts require
explicit review and an update here. Client input is never executed.

This is not production-ready. Before installation, implement and independently
review a confined SFTP upload, bounded and isolated archive extraction, safe
release and rollback operations, concurrency and filesystem race protection,
and the exact loopback checks. Test these against adversarial filesystem and
protocol fixtures and verify compatibility with the actual SSH client and host.
No installation, connection, deployment, or production change was performed.

Run the focused tests with `python3 -m unittest discover -s deploy/hostinger-ssh-wrapper -p 'test_*.py'`.

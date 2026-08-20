# One worker, deliberately.
#
# The login throttle keeps its per-IP attempt counts in process memory, so N
# workers would allow N times the failed guesses before locking. The analysis
# itself is a sub-second CPU task for a single analyst, so concurrency buys
# nothing here and costs a security property.
#
# If this ever needs more than one worker, move the throttle into the shared
# data directory first.
web: gunicorn --chdir credit-analyzer/web --workers 1 --threads 4 --timeout 120 --access-logfile - app:app

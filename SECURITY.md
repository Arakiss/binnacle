# Security

binnacle runs inside your Claude Code session with the session's own access: it reads the
session's events, runs `git`, `gh`, `ps` and `date`, reads the output files of background shells,
and writes its state under its own `state/` folder. When readings are on, it sends a small model
what each loop was asked, said and did, through the session's own client.

If you find a way binnacle exposes more than that, runs something it should not, or lets text
from a session's work steer it, please report it privately: open a
[security advisory](https://github.com/Arakiss/binnacle/security/advisories/new) rather than a
public issue. Expect an answer within a week.

Only the latest version is supported.

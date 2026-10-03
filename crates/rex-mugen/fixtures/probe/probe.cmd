; Probe CMD
[Command]
name = "a"
command = a
time = 1

[Statedef -1]

[State -1, Punch]
type = ChangeState
value = 200
triggerall = command = "a"
trigger1 = stateno = 0

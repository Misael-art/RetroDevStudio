[Command]
name = "a"
command = a
time = 1

[Command]
name = "fwd"
command = F
time = 1

[Statedef -1]

[State -1, Attack]
type = ChangeState
value = 200
triggerall = command = "a"
trigger1 = stateno = 0

[State -1, Walk]
type = ChangeState
value = 20
triggerall = command = "fwd"
trigger1 = stateno = 0

[Command]
name = "kick"
command = b
time = 1

[Command]
name = "taunt"
command = c
time = 1

[Statedef -1]

[State -1, Kick]
type = ChangeState
value = 210
triggerall = command = "kick"
trigger1 = stateno = 0

[State -1, Taunt]
type = ChangeState
value = 230
trigger1 = command = "taunt" && Time > 10

[State -1, Alt]
type = ChangeState
value = 0
trigger1 = command = "kick"
trigger2 = command = "taunt"

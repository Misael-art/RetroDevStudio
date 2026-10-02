[Command]
name = "a"
command = a
time = 1

[Command]
name = "fwd"
command = F
time = 1

[Command]
name = "back"
command = B
time = 1

[Command]
name = "neutral"
command = 5
time = 1

[Statedef -1]

[State -1, Fwd0]
type = ChangeState
value = 20
triggerall = command = "fwd"
trigger1 = stateno = 0

[State -1, Fwd21]
type = ChangeState
value = 20
triggerall = command = "fwd"
trigger1 = stateno = 21

[State -1, Back0]
type = ChangeState
value = 21
triggerall = command = "back"
trigger1 = stateno = 0

[State -1, Back20]
type = ChangeState
value = 21
triggerall = command = "back"
trigger1 = stateno = 20

[State -1, Stop20]
type = ChangeState
value = 0
triggerall = command = "neutral"
trigger1 = stateno = 20

[State -1, Stop21]
type = ChangeState
value = 0
triggerall = command = "neutral"
trigger1 = stateno = 21

[State -1, Attack]
type = ChangeState
value = 200
triggerall = command = "a"
trigger1 = stateno = 0


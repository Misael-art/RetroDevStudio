extends CharacterBody2D

const SPEED = 90.0
const JUMP_VELOCITY = -220.0
const GRAVITY = 500.0

func _ready():
	$AnimatedSprite2D.play("idle")

func _process(delta):
	if Input.is_action_pressed("ui_right"):
		$AnimatedSprite2D.play("run")
	elif Input.is_action_pressed("ui_left"):
		$AnimatedSprite2D.play("run")
	else:
		$AnimatedSprite2D.play("idle")

func _physics_process(delta):
	var direction = 0.0
	if Input.is_action_pressed("ui_right"):
		direction += 1.0
	if Input.is_action_pressed("ui_left"):
		direction -= 1.0
	velocity.x = direction * SPEED
	velocity.y += GRAVITY * delta
	if Input.is_action_just_pressed("ui_accept"):
		velocity.y = JUMP_VELOCITY
	move_and_slide()


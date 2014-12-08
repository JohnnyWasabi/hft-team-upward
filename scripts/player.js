/*
 * Copyright 2014, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

define([
    'hft/misc/misc',
    'hft/misc/strings',
    '../bower_components/hft-utils/dist/2d',
    '../bower_components/hft-utils/dist/imageutils',
    './canvas-utils',
    './math',
    './gift',
  ], function(
    Misc,
    Strings,
    M2D,
    ImageUtils,
    CanvasUtils,
    gmath,
    Gift) {

  var nameFontOptions = {
    font: "20px sans-serif",
    xOffset: 1,
    yOffset: 18,
    height: 20,
    padding: 3,
    fillStyle: "white",
  };

  var setCanvasFontStyles = function(ctx, options) {
    if (options.font        ) { ctx.font         = options.font;        }
    if (options.fillStyle   ) { ctx.fillStyle    = options.fillStyle;   }
    if (options.textAlign   ) { ctx.textAlign    = options.textAlign;   }
    if (options.testBaseline) { ctx.textBaseline = options.textBaselne; }
  };

  var computeDistSq = function(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return dx * dx + dy * dy;
  };

  /**
   * Player represnt a player in the game.
   * @constructor
   */
  var Player = (function() {
    return function(services, width, height, direction, name, netPlayer, startPosition, data, isLocalPlayer, teamIndex) {
      var isNewPlayer = data === undefined;
      data = data || {};
      var globals = services.globals;
      this.services = services;
      this.renderer = services.renderer;
      services.entitySystem.addEntity(this);
      services.drawSystem.addEntity(this);
      this.netPlayer = netPlayer;
      this.velocity = [0, 0];
      this.acceleration = [0, 0];
      this.stopFriction = globals.stopFriction;
      this.walkAcceleration = globals.moveAcceleration;
      this.isLocalPlayer = isLocalPlayer;
      this.hasHat = false;
      this.hasGift = data.hasGift || false;
      this.teamIndex = teamIndex; // 0 = team read,  = team blue

      this.sprite = this.services.spriteManager.createSprite();
      this.nameSprite = this.services.spriteManager.createSprite();
      this.hatSprite = this.services.spriteManager.createSprite();
      this.giftSprite = this.services.spriteManager.createSprite();

      this.setAvatar(data.avatarNdx !== undefined ? data.avatarNdx : Misc.randInt(this.services.avatars.length));
      this.setColor(data.color || { h: Math.random(), s: 0, v: 0 });

      this.animTimer = 0;
      this.width = width;
      this.height = height;
      this.scale = 1;
      this.canJump = false;
      this.checkWallOffset = [
        -this.width / 2,
        this.width / 2 - 1,
      ];
      this.timeAccumulator = 0;
      this.moveVector = {};
      this.workVector = {};
      this.tileVector = {};

      netPlayer.addEventListener('disconnect', Player.prototype.handleDisconnect.bind(this));
      netPlayer.addEventListener('move', Player.prototype.handleMoveMsg.bind(this));
      netPlayer.addEventListener('jump', Player.prototype.handleJumpMsg.bind(this));
      netPlayer.addEventListener('busy', Player.prototype.handleBusyMsg.bind(this));
      netPlayer.addEventListener('go', Player.prototype.handleGoMsg.bind(this));
      netPlayer.addEventListener('setName', function() {});

      this.setName(name);
      this.direction = data.direction || 0;      // direction player is pushing (-1, 0, 1)
      this.facing = data.facing || direction;    // direction player is facing (-1, 1)
      this.score = data.score || 0;
//      this.addPoints(0);

      this.teleUpDest = [0,0];

      this.posDestTeleport = [0,0];
      this.reset(startPosition);
      if (data.velocity) {
        this.velocity[0] = data.velocity[0];
        this.velocity[1] = data.velocity[1];
        this.setState('move');
      } else if (isNewPlayer && !isLocalPlayer) {
        this.setState('waitForGo');
      } else {
        this.setState('idle');
      }

//this.setState('fall');
//this.position[0] = 393 + 10;
//this.position[1] = 466 - 10;
//this.lastPosition[0] = 402 + 11;
//this.lastPosition[1] = 466 - 10;
//this.velocity[0] = -200;
//this.velocity[1] =  370;

      // force player near end
//      this.position[0] = 800;
//      this.position[1] = 32;

      this.checkBounds();
    };
  }());

  Player.prototype.setColor = function(color) {
    this.color = {
       h: color.h,
       s: color.s,
       v: color.v,
       hsv: [color.h, color.s, color.v, 0],
    };
    this.sprite.uniforms.u_hsvaAdjust = this.color.hsv.slice();
    this.hatSprite.uniforms.u_hsvaAdjust = this.color.hsv.slice();
    this.giftSprite.uniforms.u_hsvaAdjust = this.color.hsv.slice();
  };

  Player.prototype.setAvatar = function(avatarNdx) {
    this.avatarNdx = avatarNdx;
    this.avatar = this.services.avatars[avatarNdx];
    this.anims  = this.avatar.anims;
    this.idleAnimSpeed = (0.8 + Math.random() * 0.4) * this.avatar.idleAnimSpeed;
    this.sprite.uniforms.u_adjustRange = this.avatar.range.slice();

    this.animHat = this.services.images.hat.frames;
    this.animGift = this.services.images.gift.frames;
  };

  Player.prototype.setName = function(name) {
    if (name != this.playerName) {
      this.playerName = name;
      nameFontOptions.prepFn = function(ctx) {

        
        var h = (this.teamIndex == 0) ? 0 : 0.677; //(this.avatar.baseHSV[0] + this.color.h) % 1;
        var s = 1; //gmath.clamp(this.avatar.baseHSV[1] + this.color.s, 0, 1);
        var v = 1; //gmath.clamp(this.avatar.baseHSV[2] + this.color.v, 0, 1);
        var brightness = (0.2126 * this.avatar.baseColor[0] / 255 + 0.7152 * this.avatar.baseColor[1] / 255 + 0.0722 * this.avatar.baseColor[2] / 255);
        nameFontOptions.fillStyle = "white"; //brightness > 0.6 ? "black" : "white";
        var rgb = ImageUtils.hsvToRgb(h, s, v);
        ctx.beginPath();
        CanvasUtils.roundedRect(ctx, 0, 0, ctx.canvas.width, ctx.canvas.height, 10);
        ctx.fillStyle = "rgb(" + rgb.join(",") + ")";
        ctx.fill();
      }.bind(this);

      this.nameImage = this.services.createTexture(
          ImageUtils.makeTextImage(name, nameFontOptions));
    }
  };

  Player.prototype.reset = function(startPosition) {
    var levelManager = this.services.levelManager;
    var level = levelManager.getLevel();
    var position = startPosition || levelManager.getRandomOpenPosition();
    this.position = [position.x, position.y];
    this.lastPosition = [this.position[0], this.position[1]];
    this.setAvatar(this.avatarNdx);
  };

  Player.prototype.updateMoveVector = function() {
    this.moveVector.x = this.position[0] - this.lastPosition[0];
    this.moveVector.y = this.position[1] - this.lastPosition[1];
  };

  Player.prototype.checkCollisions = function() {
    var levelManager = this.services.levelManager;
    var level = levelManager.getLevel();

    var xp = this.lastPosition[0];
    var yp = this.lastPosition[1];

    var tile = 0;
  };

  Player.prototype.addPoints = function(points) {
    this.score += points;
    this.sendCmd('score', {points: points});
  };

  Player.prototype.setState = function(state) {
    this.state = state;
    var init = this["init_" + state];
    if (init) {
      init.call(this);
    }
    this.process = this["state_" + state];
  };

  Player.prototype.checkBounds = function() {
    var levelManager = this.services.levelManager;
    var level = levelManager.getLevel();

    if (this.position[1] >= level.levelHeight) {
      debugger;
    }
  };

  Player.prototype.checkJump = function() {
    if (this.canJump) {
      if (this.jump) {
        this.canJump = false;
        this.setState('jump');
        return true;
      }
    } else {
      if (!this.jump) {
        this.canJump = true;
      }
    }
  };

//  Player.prototype.process = function() {
//    this.checkBounds();
//    this["state_" + this.state].call(this);
//  };

  Player.prototype.removeFromGame = function() {
    if (this.gift) {
      this.gift.removeFromGame();
      this.gift = null;
    }
    this.services.spriteManager.deleteSprite(this.sprite);
    this.services.spriteManager.deleteSprite(this.nameSprite);
    this.services.spriteManager.deleteSprite(this.hatSprite);
    this.services.spriteManager.deleteSprite(this.giftSprite);
    this.services.entitySystem.removeEntity(this);
    this.services.drawSystem.removeEntity(this);
    this.services.playerManager.removePlayer(this);
  };

  Player.prototype.handleDisconnect = function() {
    this.removeFromGame();
  };

  Player.prototype.handleBusyMsg = function(msg) {
    // We ignore this message
  };

  Player.prototype.handleMoveMsg = function(msg) {
    this.direction = msg.dir;
    if (this.direction) {
      this.facing = this.direction;
    }
  };

  Player.prototype.handleJumpMsg = function(msg) {
    this.jump = msg.jump;
    if (this.jump == 0) {
      this.jumpTimer = 0;
    }
  };

  Player.prototype.handleGoMsg = function(msg) {
    this.color = {
      h: msg.h,
      s: msg.s,
      v: msg.v,
    };

    this.setColor(msg.color);
    this.setAvatar(msg.avatar);
    this.setName(msg.name.replace(/[<>]/g, ''));

    this.position[0] = this.lastPosition[0];
    this.position[1] = this.lastPosition[1];
    this.setState("idle");
  };

  Player.prototype.sendCmd = function(cmd, data) {
    this.netPlayer.sendCmd(cmd, data);
  };

  Player.prototype.updatePhysics = (function() {
    var updatePosition = function(axis, elapsedTime) {
      var axis = axis || 3;
      if (axis & 1) {
        this.position[0] += this.velocity[0] * elapsedTime;
      }
      if (axis & 3) {
        this.position[1] += this.velocity[1] * elapsedTime;
      }
    };

    var updateVelocity = function(axis, elapsedTime) {
      var globals = this.services.globals;
      var axis = axis || 3;
      if (axis & 1) {
        this.velocity[0] += this.acceleration[0] * elapsedTime;
        this.velocity[0] = Misc.clampPlusMinus(this.velocity[0], globals.maxVelocity[0]);
      }
      if (axis & 2) {
        this.velocity[1] += (this.acceleration[1] + this.gravity) * elapsedTime;
        this.velocity[1] = Misc.clampPlusMinus(this.velocity[1], this.maxVelocityY);
      }
    };


    return function(axis) {
      var globals = this.services.globals;
      var levelManager = this.services.levelManager;
      var tile = levelManager.getTileInfoByPixel(this.position[0], this.position[1]);
      this.gravity = tile.ladder ? globals.ladderGravity : globals.gravity;
      this.maxVelocityY = (tile.ladder && this.velocity[1] > 0) ? globals.ladderMaxVelocityY : globals.maxVelocity[1];
      var kOneTick = 1 / 60;
      this.timeAccumulator += globals.elapsedTime;
      var ticks = (this.timeAccumulator / kOneTick) | 0;
      this.timeAccumulator -= ticks * kOneTick;
      this.lastPosition[0] = this.position[0];
      this.lastPosition[1] = this.position[1];
      for (var ii = 0; ii < ticks; ++ii) {
        updateVelocity.call(this, axis, kOneTick);
        updatePosition.call(this, axis, kOneTick);
      }
    };
  }());

  Player.prototype.init_idle = function() {
    this.velocity[0] = 0;
    this.velocity[1] = 0;
    this.acceleration[0] = 0;
    this.acceleration[1] = 0;
    this.animTimer = 0;
    this.animSet = this.anims.idle;
    this.anim = this.anims.idle.frames;
  };

  Player.prototype.state_idle = function() {
    if (this.checkJump()) {
      return;
    } else if (this.direction) {
      this.setState('move');
      return;
    }
    var globals = this.services.globals;
    this.animTimer += globals.elapsedTime * this.idleAnimSpeed;
    this.checkFall();
  };

  Player.prototype.init_fall = function() {
    var globals = this.services.globals;
    this.animTimer = 1;
    this.animSet = this.anims.jump;
    this.anim = this.anims.jump.frames;
  };

  Player.prototype.state_fall = function() {
    var globals = this.services.globals;
    var levelManager = this.services.levelManager;
    var tile = levelManager.getTileInfoByPixel(this.position[0], this.position[1]);
    if (tile.ladder) {
      if (this.checkJump()) {
        return;
      }
    }
    this.acceleration[0] = this.direction * globals.moveAcceleration;
    this.updatePhysics();
    var landed = this.checkLand();
    if (this.checkWall()) {
      return;
    }
    if (landed) {
      return;
    }
    if (Math.abs(this.velocity[1]) < globals.fallTopAnimVelocity) {
      this.animTimer = 2;
    } else if (this.velocity[1] >= globals.fallTopAnimVelocity) {
      this.animTimer = 3;
    }
  };

  Player.prototype.init_teleport = function() {
    var dx = this.posDestTeleport[0] - this.position[0];
    var dy = this.posDestTeleport[1] - this.position[1];
    this.distTeleport = Math.sqrt(dx*dx + dy*dy);
    this.dxHalfTeleport = dx * 0.5;
    this.dyHalfTeleport = dy * 0.5;
    this.timeTeleport = 0.25 + this.distTeleport / 500;
    this.rotationsTeleport = Math.PI * 2 * (1 + this.distTeleport / 100);
    this.elapsedTimeTeleport = 0;
    this.animTimer = 0;
    this.animSet = this.anims.idle;
    this.anim = this.anims.idle.frames;
  };

  Player.prototype.state_teleport = function() {

    var globals = this.services.globals;
    this.animTimer += globals.elapsedTime * this.idleAnimSpeed;
    
    this.elapsedTimeTeleport += globals.elapsedTime;
    if (this.elapsedTimeTeleport >= this.timeTeleport) {
      this.position[0] = this.posDestTeleport[0];
      this.position[1] = this.posDestTeleport[1];
      this.sprite.rotation = 0;

      if (globals.levelName == "level5-0") {

        this.addConfettiNearPlayer(1000 * 0);
       // this.addConfettiNearPlayer(1000 * 0.5);
       // this.addConfettiNearPlayer(1000 * 1.0);

        if (this.hasGift) {
          this.hasHat = true;
          this.hasGift = false;
          this.giftSprite.visible = false;
          this.nameSprite.visible = false;
          this.gift = new Gift(this.services, this); //this.position, this.velocity);
        }
      }
      this.setState(this.statePrevTeleport);

    } else {
      var lerp = (this.elapsedTimeTeleport/this.timeTeleport)
      var cosTime = Math.cos( lerp * Math.PI);
      this.position[0] = this.posDestTeleport[0] - this.dxHalfTeleport - cosTime * this.dxHalfTeleport;
      this.position[1] = this.posDestTeleport[1] - this.dyHalfTeleport - cosTime * this.dyHalfTeleport;
      this.sprite.rotation = (cosTime+1)*0.5 * this.rotationsTeleport;
    }
  };

  Player.prototype.teleportToOtherGame = function(dir, dest, subDest) {
    // HACK!
    var globals = this.services.globals;
    var parts = /s(\d+)-(\d+)/.exec(globals.id);
    var id = parseInt(parts[1]) + parseInt(parts[2]) * globals.columns;
    var numScreens = globals.columns * globals.rows;
    id = gmath.emod(id + dir, numScreens);
    var id = "s" + (id % globals.columns) + "-" + (Math.floor(id / globals.columns));
    this.netPlayer.switchGame(id, {
      name: this.playerName,    // Send the name because otherwise we'll make a new one up
      avatarNdx: this.avatarNdx,// Send the avatarNdx so we get the same player
      dest: dest,               // Send the dest so we know where to start
      subDest: subDest,         // Send the subDest so we know which subDest to start
      color: this.color,        // Send the color so we don't pick a new one
      direction: this.direction,// Send the direction so if we're moving we're still moving.
      facing: this.facing,      // Send the facing so we're facing the sme way
      velocity: this.velocity,  // Send the velocity so where going the right speed
      score: this.score,        // Send the score
      position: this.position,  // Send the position incase there's no dest.
      hasGift: this.hasGift,    // Send the carrying-gift flag.
    });
  };

  Player.prototype.addConfettiNearPlayer = function(delay) {
    var x = this.position[0];// - 150 + Misc.randInt(300);
    var y = this.position[1] - this.height/2; // - 100 + Misc.randInt(200);
    var pm = this.services.particleEffectManager;
    setTimeout(function() {
      pm.spawnConfetti(x, y);
    }, delay);
  };

  Player.prototype.addPlayerToScoreboard = function() {
    // make sure we can't get added twice
    if (this.addedToScoreboard) {
      return;
    }
    this.addedToScoreboard = true;
    var scoreManager = this.services.scoreManager;
    if (scoreManager) {
      var places = scoreManager.addPlayer({
        score: this.score,
        name: this.playerName,
        color: {
          h: this.color.h,
        },
        avatarNdx: this.avatarNdx,
      });
    }
    return places;
  };

  // returns true if we teleported
  Player.prototype.checkWall = function() {
    var globals = this.services.globals;
    var levelManager = this.services.levelManager;
    var level = levelManager.getLevel();
    var off = this.velocity[0] < 0 ? 0 : 1;
    for (var ii = 0; ii < 2; ++ii) {
      var xCheck = this.position[0] + this.checkWallOffset[off];
      if (!globals.noExit && !this.isLocalPlayer && xCheck < 0) {
        if (xCheck < -level.tileWidth / 2) {
          this.teleportToOtherGame(-1);
          return true;
        }
      } else if (!globals.noExit && !this.isLocalPlayer && xCheck >= level.levelWidth) {
        if (xCheck >= level.levelWidth + level.tileWidth / 2) {
          this.teleportToOtherGame(1);
          return true;
        }
      } else {
        var yCheck = this.position[1] - this.height / 4 - this.height / 2 * ii;
        var tile = levelManager.getTileInfoByPixel(xCheck, yCheck);
        if (tile.collisions && (!tile.sideBits || (tile.sideBits & 0x3))) {
          this.velocity[0] = 0;
          var distInTile = gmath.emod(xCheck, level.tileWidth);
          var xoff = off ? -distInTile : level.tileWidth - distInTile;
          this.position[0] += xoff;
        }
        if (tile.teleport) {
          if (tile.end && !globals.noExit) {
            // it's the end
            this.targetX = (gmath.unitdiv(xCheck, level.tileWidth ) + 0.5) * level.tileWidth;
            this.targetY = (gmath.unitdiv(yCheck, level.tileHeight) +   1) * level.tileHeight;
            this.setState("end");
          } else if (tile.local) {
            // it's a local teleport
            var dest = level.getLocalDest(tile.dest);
            if (!dest) {
              console.error("missing local dest for dest: " + tile.dest);
              return true;
            }

            dest = dest[Misc.randInt(dest.length)];
            this.posDestTeleport[0] =  (dest.tx + 0.5) * level.tileWidth;
            this.posDestTeleport[1] =  (dest.ty +   1) * level.tileHeight - 1;
            this.statePrevTeleport = this.state;
            this.setState("teleport");
            //this.position[0] = (dest.tx + 0.5) * level.tileWidth;
            //this.position[1] = (dest.ty +   1) * level.tileHeight - 1;

          } else {
            // comment this in to allow level to level teleports
//            var dir = (tile.dest == 0 || tile.dest == 2) ? -1 : 1;
//            this.teleportToOtherGame(dir, tile.dest, tile.subDest);
          }
          return true; // we teleported. Stop checking
        } else if (tile.gift && !this.hasGift) {
          this.hasGift = true;
          //this.services.particleEffectManager.spawnBallRedConfetti(this.position[0], this.position[1] - 32);
          this.elapsedTimeGift = 0;
        }
      }
    }
  };

  Player.prototype.TeleportUp = function(positionDest)  {
            this.posDestTeleport[0] =  positionDest[0];
            this.posDestTeleport[1] =  positionDest[1];
            this.statePrevTeleport = this.state;
            this.velocity[0] = 0;
            this.velocity[1] = 0;
            this.setState("teleport");
            this.services.globals.teamScoreInts[1-this.teamIndex] += 1;
  };

  Player.prototype.checkFall = function() {
    var globals = this.services.globals;
    var levelManager = this.services.levelManager;
    var level = levelManager.getLevel();

    var levelManager = this.services.levelManager;
    for (var ii = 0; ii < 2; ++ii) {
      var tile = levelManager.getTileInfoByPixel(this.position[0] - this.width / 4 + this.width / 2 * ii, this.position[1]);
      if (tile.collisions && (!tile.sideBits || (tile.sideBits & 0x8))) {
        this.stopFriction = tile.stopFriction || globals.stopFriction;
        this.walkAcceleration = tile.walkAcceleration || globals.moveAcceleration;
        if (tile.thing == "switch") {
          var doorSwitches = level.getThings("switch")[tile.id];
          // find the closest
          var closestSwitch = doorSwitches[0].doorSwitch;
          var closestDist = computeDistSq(this.position, closestSwitch.position);
          for (var ii = 1; ii < doorSwitches.length; ++ii) {
            var doorSwitch = doorSwitches[ii].doorSwitch;
            var dist = computeDistSq(this.position, doorSwitch.position);
            if (dist < closestDist) {
              closestDist = dist;
              closestSwitch = doorSwitch;
            }
          }
          closestSwitch.switchOn();
        }
        return false;
      }
    }
    if (this.checkHeadStand()) return false;

    this.setState('fall');
    this.bonked = false;    // allows player to stand on othe player's head afte jumping and bonking then landing then walking off platform onto player's head.
    return true;
  };

  Player.prototype.checkUp = function() {
    var levelManager = this.services.levelManager;
    for (var ii = 0; ii < 2; ++ii) {
      var tile = levelManager.getTileInfoByPixel(this.position[0] - this.width / 4 + this.width / 2 * ii, this.position[1] - this.height);
      if (tile.collisions && (!tile.sideBits || (tile.sideBits & 0x4))) {
        var level = levelManager.getLevel();
        this.velocity[1] = 0;
        this.position[1] = (gmath.unitdiv(this.position[1], level.tileHeight) + 1) * level.tileHeight;
        if (!this.bonked) {
          this.bonked = true;
          this.services.audioManager.playSound('bonkhead');
          this.services.particleEffectManager.spawnBonk(this.position[0], this.position[1] - this.height);
        }
        return true;
      }
    }
    return false;
  };

  Player.prototype.checkDown = function() {
    var globals = this.services.globals;
    var levelManager = this.services.levelManager;
    var level = levelManager.getLevel();
    for (var ii = 0; ii < 2; ++ii) {
      var tile = levelManager.getTileInfoByPixel(this.position[0] - this.width / 4 + this.width / 2 * ii, this.position[1]);
      if (tile.collisions && (!tile.sideBits || (tile.sideBits & 0x8))) {
        var ty = gmath.unitdiv(this.position[1], level.tileHeight) * level.tileHeight + (tile.top || 0);
        if (!tile.oneWay || this.lastPosition[1] < ty) {
          this.position[1] = ty;
          this.velocity[1] = 0;
          this.stopFriction = tile.stopFriction || globals.stopFriction;
          this.services.audioManager.playSound('land');
          this.setState('move');
        }
        return true;
      }
    }
    if (this.checkHeadStand()) {
          this.velocity[1] = 0;
          this.stopFriction =  globals.stopFriction;
          this.services.audioManager.playSound('land');
          this.setState('move');
          return true;
     }
    return false;
  };

  Player.prototype.checkLand = function() {
    if (this.velocity[1] > 0) {
      return this.checkDown();
    } else {
      return this.checkUp();
    }
  };

  Player.prototype.checkHeadStand = function(){
    if (!this.services.globals.allowStandOnPlayers || this.jump || this.bonked) return false;
    if (!this.checkPlayerHead) {
      this.checkPlayerHead = function(player) {
        if (player == this) return false;
        if (player.velocity[1] < 0 && !this.services.globals.allowStoodOnToBumpYou) return false; // no pushing me up from under by jumping under me.
        var halfWidthHim = player.sprite.width * 0.25;
        if (this.position[0] - this.halfWidthMe > player.position[0] + halfWidthHim) return false;  // to right of player's right side
        if (this.position[0] + this.halfWidthMe < player.position[0] - halfWidthHim) return false;  // to left of player's left side 
        var heightHim = 30;
        if (this.position[1] - this.heightMe > player.position[1]) return false;               // below player's bottom 
        if (this.position[1]  < player.position[1] - heightHim) return false;            // above player's top

        if (this.position[1] > player.position[1]- heightHim*0.5) return; // no good if half way into guy below me.

        this.position[1] = player.position[1] - heightHim;
        if (player.velocity[1] < 0)
        	this.velocity[1] = player.velocity[1];
        else
        	this.velocity[1] = 0;
        if (this.position[1] < this.lastPosition[1]) {
          this.checkUp(); // This will set the bonk flag if he hits a tile, which will make him no longer stand on other players until he jumps again.
        }
        return true;
      }.bind(this);
    }
    this.halfWidthMe = this.sprite.width * 0.25;
    this.heightMe = 30;
    return this.services.playerManager.forEachPlayer(this.checkPlayerHead);
  }

  Player.prototype.init_move = function() {
    this.animTimer = 0;
    this.animSet = this.anims.move;
    this.anim = this.anims.move.frames;
    this.lastDirection = this.direction;
  };

  Player.prototype.state_move = function() {
    if (this.checkJump()) {
      return;
    }

    var globals = this.services.globals;
    this.acceleration[0] = this.lastDirection * this.walkAcceleration;
    this.animTimer += this.avatar.moveAnimSpeed * Math.abs(this.velocity[0]) * globals.elapsedTime;
    this.updatePhysics(1);

    if (this.checkWall()) {
      return;
    }
    this.checkFall();

    if (!this.direction) {
      this.setState('stop');
      return;
    }

    this.lastDirection = this.direction;
  };

  Player.prototype.init_stop = function() {
    this.lastDirection = this.direction;
    this.acceleration[0] = 0;
  };

  Player.prototype.state_stop = function() {
    if (this.checkJump()) {
      return;
    }

    if (this.direction) {
      this.setState('move');
      return;
    }

    var globals = this.services.globals;
    this.velocity[0] *= this.stopFriction;
    if (Math.abs(this.velocity[0]) < globals.minStopVelocity) {
      this.setState('idle');
      return;
    }

    this.animTimer += this.avatar.moveAnimSpeed * Math.abs(this.velocity[0]) * globals.elapsedTime;
    this.updatePhysics(1);
    if (this.checkWall()) {
      return;
    }
    this.checkFall();
  };

  Player.prototype.init_jump = function() {
    var globals = this.services.globals;
    this.jumpTimer = 0;
    this.animTimer = 0;
    this.bonked = false;
    this.animSet = this.anims.jump;
    this.anim = this.anims.jump.frames;
    this.services.audioManager.playSound('jump');
  };

  Player.prototype.state_jump = function() {
    var globals = this.services.globals;
    this.acceleration[0] = this.direction * globals.moveAcceleration;
    this.velocity[1] = globals.jumpVelocity;
    this.jumpTimer += globals.elapsedTime;
    this.updatePhysics();
    this.checkLand();
    if (this.checkWall()) {
      return;
    }
    if (this.jumpTimer >= globals.jumpFirstFrameTime) {
      this.animTimer = 1;
    }
    if (this.jumpTimer >= globals.jumpDuration || !this.jump) {
      this.setState('fall');
    }
  };

  Player.prototype.init_waitForGo = function() {
    this.lastPosition[0] = this.position[0];
    this.lastPosition[1] = this.position[1];
    this.animSet = this.anims.idle;
    this.anim = this.anims.idle.frames;

    // move us off the screen so no collisions happen
    this.position[0] = -1000;
    this.position[1] = -1000;
  };

  Player.prototype.state_waitForGo = function() {
    // Do nada.
  };

  Player.prototype.init_end = function() {
    this.animTimer = 0;
    this.lastPosition[0] = this.position[0];
    this.lastPosition[1] = this.position[1];
    if (this.gift) {
      this.gift.removeFromGame();
      this.gift = null;
    }
    if (this.hasHat) {
      this.hatSprite.visible = false;
      this.hasHat = false;
    }
  };

  Player.prototype.state_end = function() {
    var globals = this.services.globals;
    this.animTimer += globals.elapsedTime;
 //   this.animTimer = this.animTimer % globals.endDuration;
    var lerp = this.animTimer / globals.endDuration;
    var plerp = Math.sin(lerp * Math.PI / 2);
    this.position[0] = gmath.clampedLerp(this.lastPosition[0], this.targetX, plerp);
    this.position[1] = gmath.clampedLerp(this.lastPosition[1], this.targetY, plerp);
    this.sprite.rotation += globals.elapsedTime * globals.endRotationSpeed;
    this.scale     = Math.max(0, 1 - lerp);
    if (lerp >= 1) {
      this.setState("done");
    }
  };

  Player.prototype.init_done = function() {
    // move the player off the screen so collisions don't happen
    this.position[0] = -1000;
    this.position[1] = -1000;
    var places = this.addPlayerToScoreboard();
    this.sendCmd('done', {
      places: places,
      score: this.score,
    });
  };

  Player.prototype.state_done = function() {
    // do nothing, we're done
  };

  Player.prototype.draw = function() {
    var globals = this.services.globals;
    var images = this.services.images;
    var spriteRenderer = this.services.spriteRenderer;
    var frameNumber = Math.floor(this.animTimer % this.anim.length);
    var img = this.anim[frameNumber];

    var off = {};
    this.services.levelManager.getDrawOffset(off);

    var width  = img.img.width  * this.avatar.scale; //32;
    var height = img.img.height * this.avatar.scale; //32;

    var sprite = this.sprite;
    sprite.uniforms.u_texture = img;
    sprite.x = off.x + ((              this.position[0]) | 0) * globals.scale;
    sprite.y = off.y + ((height / -2 + this.position[1]) | 0) * globals.scale;
    sprite.width  = width  * globals.scale * this.scale;
    sprite.height = height * globals.scale * this.scale;
    sprite.xScale = this.facing > 0 ? 1 : -1;

    if (this.state != "teleport" && sprite.y > (22*32)) { //ctx.canvas.height) {
      if (!this.FindTeleUpDest) {
        this.FindTeleUpDest = function(player) {
          if (player == this) return false;
          if (player.position[1] < this.teleUpDest[1]) {
            this.teleUpDest[0] = player.position[0];
            this.teleUpDest[1] = player.position[1];
          }
          return true;
        }.bind(this);
      }
      this.gotTeamTeleUp = false;
      this.teleUpDest[0] = this.position[0];
      this.teleUpDest[1] = this.position[1];
      this.services.playerManager.forEachPlayer(this.FindTeleUpDest);
      if (this.teleUpDest[1] < this.position[1]) {
        this.TeleportUp(this.teleUpDest);
      }
    }

    var dyName = 0;
    if (this.hasGift) {
      var dy = 0;
      var rot = 0;
      var scale = 1;
      this.elapsedTimeGift += globals.elapsedTime;
      var timGiftDuration = 1.0;
      if (this.elapsedTimeGift < timGiftDuration){
        var lerp = (this.elapsedTimeGift / timGiftDuration);
        var sinLerp = Math.sin(lerp * Math.PI * 0.80);
        dy = 58 -96 * sinLerp;
        rot = (Math.PI *2 * 5) * lerp;
        scale = 1 + 1 * Math.sin(lerp * Math.PI);
      }
      img = this.animGift[0];
      this.giftScale = gmath.clamp(this.score / 300, 0.5, 2.0);
      var sprite = this.giftSprite;
      sprite.rotation = rot;
      sprite.uniforms.u_texture = img;
      sprite.xScale = scale; //this.facing > 0 ? scale : -scale;     
      sprite.yScale = scale;
      sprite.x = off.x + ((    this.position[0]) | 0) * globals.scale;
      sprite.y = off.y + (( (height * this.giftScale / -2)  + this.position[1]) -64 + dy| 0) * globals.scale;
      sprite.width  = img.img.width * this.giftScale; //globals.scale;
      sprite.height = img.img.height * this.giftScale; //globals.scale;
      dyName = -27; 
    }
    if (this.hasHat) {
        var dxHat = (this.animSet.dxHat) ? this.animSet.dxHat[frameNumber] : (this.avatar.dxHat || 0);
        var dyHat = (this.animSet.dyHat) ? this.animSet.dyHat[frameNumber] : (this.avatar.dyHat || 0);
//        if (this.animSet.dxhat != 0 && this.avatar.dxHatMove ) {
//          dxHat = this.avatar.dxHatMove;
//        }
      img = this.animHat[0];
      var sprite = this.hatSprite;
      sprite.uniforms.u_texture = img;
      sprite.xScale = this.facing > 0 ? 1 : -1;
      sprite.x = off.x + ((    (dxHat * sprite.xScale)  +        this.position[0]) | 0) * globals.scale;
      sprite.y = off.y + (( (height / -2) * 2.5 + this.position[1]) + dyHat | 0) * globals.scale;
      sprite.width  = img.img.width;//  * globals.scale;
      sprite.height = img.img.height;// * globals.scale;
 
    } else {
      var nameSprite = this.nameSprite;
      nameSprite.uniforms.u_texture = this.nameImage;
      nameSprite.x = off.x + ((              this.position[0])      | 0) * globals.scale;
      nameSprite.y = off.y + ((height / -2 + this.position[1] - 36 ) | 0) * globals.scale;
      nameSprite.width  = this.nameImage.img.width  * globals.scale;
      nameSprite.height = this.nameImage.img.height * globals.scale;
    }
  };

  return Player;
});

